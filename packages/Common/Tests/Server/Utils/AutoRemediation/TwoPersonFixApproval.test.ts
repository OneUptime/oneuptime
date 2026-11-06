import RemediationApproval, {
  getAlreadyApprovedFirstMessage,
  RemediationApprovalResult,
} from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService, {
  FirstApprovalSet,
  SuggestionTransitionSet,
} from "../../../../Server/Services/AutoRemediationSuggestionService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import UserService from "../../../../Server/Services/UserService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Project from "../../../../Models/DatabaseModels/Project";
import User from "../../../../Models/DatabaseModels/User";
import AutoRemediationApprovalSource from "../../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { ALREADY_APPROVED_FIRST_MESSAGE } from "../../../../Types/AutoRemediation/RemediationApprovals";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
  ResourceCommandTier,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { withLabelJoinTables } from "../../TestingUtils/LabelJoinTables";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * TWO PEOPLE APPROVE A RISKIER FIX (#6148's follow-up, which #5519
 * proposed).
 *
 * Where a project asks two people to approve a riskier fix
 * (Project.requireTwoApprovalsForRiskierFixes), an AI command plan that
 * holds a riskier change runs only on its second approval, by someone other
 * than whoever approved it first. RemediationApproval.approve decides it,
 * and every way to approve reaches it: the Dashboard's Approve (the route
 * calls approve with the person's props) and Approve and run in Slack and
 * Microsoft Teams (WorkspaceRemediationActions.approve with the member's
 * props, once the chat authorized them).
 *
 * The fix here changes an AWS account through its Cloud AI agent: the
 * approval's own checks run for real (the account's edit check against its
 * row, the agent, the policy), and the suggestion is one in-memory row the
 * conditional writes act on as their WHERE says - so two presses at once,
 * and a first approver pressing twice, are played out on it.
 *
 * Pinned: a second approval is needed only where the rule is on and the
 * plan holds a riskier change (a stored one, or one the policy tiers
 * riskier now); the first approval is recorded (who, when, where) and
 * nothing runs; the same person approving again is refused from the
 * Dashboard, Slack and Teams, and nothing runs; someone else's approval runs
 * it, from anywhere, and the feed names whose came first; with the rule off,
 * or for safe changes, one approval runs it, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9c000000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "9c000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9c000000-0000-4000-8000-000000000003",
);
const CLOUD_ACCOUNT_ID: string = "9c000000-0000-4000-8000-000000000004";
const AGENT_ID: string = "9c000000-0000-4000-8000-000000000005";
const PROD_LABEL_ID: ObjectID = new ObjectID(
  "9c000000-0000-4000-8000-000000000006",
);
const MAYA_ID: ObjectID = new ObjectID("9c000000-0000-4000-8000-0000000000aa");
const SAM_ID: ObjectID = new ObjectID("9c000000-0000-4000-8000-0000000000bb");

// A riskier change: stopping an instance (RiskyWrite).
const STOP_INSTANCE: string =
  "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0";
// A safe change: scaling a service out (SafeWrite).
const SCALE_OUT: string =
  "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 8";

// Where the person presses Approve: the Dashboard, or a fix's chat message.
type Where = "Dashboard" | WorkspaceType.Slack | WorkspaceType.MicrosoftTeams;

const EVERYWHERE: Array<Where> = [
  "Dashboard",
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

const SOURCE_OF: Record<Where, AutoRemediationApprovalSource> = {
  Dashboard: AutoRemediationApprovalSource.Dashboard,
  [WorkspaceType.Slack]: AutoRemediationApprovalSource.Slack,
  [WorkspaceType.MicrosoftTeams]: AutoRemediationApprovalSource.MicrosoftTeams,
};

// A project member, signed in as the given person.
function member(userId: ObjectID): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        labelIds: [],
        isBlockPermission: false,
        permission: Permission.ProjectMember,
      } as UserPermission,
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

// The same member, blocked from editing cloud accounts labelled "prod".
function blockedOnProd(userId: ObjectID): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = member(userId);

  props.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions.push({
    _type: "UserPermission",
    labelIds: [PROD_LABEL_ID],
    isBlockPermission: true,
    permission: Permission.EditCloudResource,
  } as UserPermission);

  return props;
}

function planOf(
  commandText: string,
  tier: ResourceCommandTier | undefined,
): JSONObject {
  return {
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.ResourceCommand,
        runnerId: AGENT_ID,
        runnerNameSnapshot: "Cloud AI agent",
        resourceType: AiResourceType.AwsAccount,
        resourceId: CLOUD_ACCOUNT_ID,
        resourceNameSnapshot: "prod",
        ...(tier ? { resourceCommandTier: tier } : {}),
        command: commandText,
        timeoutInMs: 60000,
        rationale: "the instance is wedged",
        expectedEffect: "the load balancer drains it",
        policyVerdict: "RequiresApproval",
      },
    ],
  } as JSONObject;
}

// The suggestion, as one row the conditional writes act on.
type Row = Record<string, unknown>;

function suggestionRow(
  plan: JSONObject = planOf(STOP_INSTANCE, ResourceCommandTier.RiskyWrite),
): Row {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    resourceType: AiResourceType.AwsAccount,
    resourceId: new ObjectID(CLOUD_ACCOUNT_ID),
    verificationWindowMinutes: 15,
    commandPlan: plan,
  };
}

function cloudStatus(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId: CLOUD_ACCOUNT_ID,
    resourceName: "prod",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.AwsAccount,
        resourceIdentifier: "123456789012",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

function account(): CloudAccount {
  const model: CloudAccount = new CloudAccount();
  model.id = new ObjectID(CLOUD_ACCOUNT_ID);
  model.projectId = PROJECT_ID;
  const prod: Label = new Label();
  prod.id = PROD_LABEL_ID;
  prod.name = "prod";
  model.labels = [prod];
  return model;
}

function person(name: string): User {
  const user: User = new User();
  user.name = new Name(name);
  return user;
}

let row: Row;
let isRuleOn: boolean;
let execute: jest.SpyInstance;
let firstWrite: jest.SpyInstance;
let secondWrite: jest.SpyInstance;
let singleWrite: jest.SpyInstance;
let feed: jest.SpyInstance;
// Set to make the next first-approval write lose to another press, as the WHERE would.
let beforeFirstWrite: (() => void) | null;

beforeEach(() => {
  withLabelJoinTables();
  row = suggestionRow();
  isRuleOn = true;
  beforeFirstWrite = null;

  // The suggestion, as the person's read and the root read pick it.
  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const select: Record<string, unknown> = (
        args as { select: Record<string, unknown> }
      ).select;
      const picked: Record<string, unknown> = { id: row["id"] };

      for (const key of Object.keys(select)) {
        if (key in row) {
          picked[key] = row[key];
        }
      }

      return picked as never;
    });

  // The three conditional writes, as their WHERE clauses decide them.
  firstWrite = jest
    .spyOn(AutoRemediationSuggestionService, "attemptFirstApproval")
    .mockImplementation(
      async (args: { set: FirstApprovalSet }): Promise<number> => {
        if (beforeFirstWrite) {
          const lose: () => void = beforeFirstWrite;
          beforeFirstWrite = null;
          lose();
        }

        if (
          row["status"] !== AutoRemediationSuggestionStatus.Suggested ||
          row["firstApprovedByUserId"]
        ) {
          return 0;
        }

        row["firstApprovedByUserId"] = new ObjectID(
          args.set.firstApprovedByUserId,
        );
        row["firstApprovedAt"] = args.set.firstApprovedAt;
        row["firstApprovedFrom"] = args.set.firstApprovedFrom;
        return 1;
      },
    ) as unknown as jest.SpyInstance;
  secondWrite = jest
    .spyOn(AutoRemediationSuggestionService, "attemptSecondApproval")
    .mockImplementation(
      async (args: {
        firstApprovedByUserId: string;
        set: SuggestionTransitionSet;
      }): Promise<number> => {
        const first: string = String(row["firstApprovedByUserId"] || "");

        if (
          row["status"] !== AutoRemediationSuggestionStatus.Suggested ||
          first.toLowerCase() !== args.firstApprovedByUserId.toLowerCase() ||
          first.toLowerCase() ===
            String(args.set.approvedByUserId || "").toLowerCase()
        ) {
          return 0;
        }

        Object.assign(row, args.set);
        return 1;
      },
    ) as unknown as jest.SpyInstance;
  singleWrite = jest
    .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
    .mockImplementation(
      async (args: {
        fromStatus: AutoRemediationSuggestionStatus;
        set: SuggestionTransitionSet;
      }): Promise<number> => {
        if (row["status"] !== args.fromStatus) {
          return 0;
        }

        Object.assign(row, args.set);
        return 1;
      },
    ) as unknown as jest.SpyInstance;

  execute = jest
    .spyOn(CommandPlanExecutor, "executeApprovedPlan")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<never> => {
      return {
        id: PROJECT_ID,
        enableAi: true,
        requireTwoApprovalsForRiskierFixes: isRuleOn,
      } as unknown as never;
    });
  jest
    .spyOn(ResourceAiAccessService, "getStatusForResource")
    .mockResolvedValue(cloudStatus());
  jest
    .spyOn(CloudAccountService, "findOneBy")
    .mockImplementation(async (): Promise<never> => {
      return account() as never;
    });
  feed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "findOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const id: string = String((args as { id: ObjectID }).id);

      if (id === MAYA_ID.toString()) {
        return person("Maya Chen") as never;
      }

      if (id === SAM_ID.toString()) {
        return person("Sam Lee") as never;
      }

      return null as never;
    });
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation(async (): Promise<never> => {
      const incident: Incident = new Incident();
      incident.title = "Checkout instance wedged";
      incident.incidentNumberWithPrefix = "INC-42";
      return incident as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The fix as a chat press reads it: the row as it is now.
function fixAsReadNow(): AutoRemediationSuggestion {
  const suggestion: AutoRemediationSuggestion = new AutoRemediationSuggestion();

  for (const [key, value] of Object.entries(row)) {
    (suggestion as unknown as Record<string, unknown>)[key] = value;
  }

  return suggestion;
}

async function approveFrom(
  where: Where,
  props: DatabaseCommonInteractionProps,
): Promise<RemediationApprovalResult | WorkspaceAnswer> {
  if (where === "Dashboard") {
    return await RemediationApproval.approve({
      props,
      suggestionId: SUGGESTION_ID.toString(),
    });
  }

  return await WorkspaceRemediationActions.approve({
    props,
    value: {
      suggestionId: SUGGESTION_ID,
      fingerprint: getRemediationPlanFingerprint(
        row as unknown as AutoRemediationSuggestion,
      ),
    },
    from: where,
    suggestion: fixAsReadNow(),
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return null;
}

function feedMarkdowns(): Array<string> {
  return feed.mock.calls.map((call: Array<unknown>): string => {
    return String(
      (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown,
    );
  });
}

describe("a riskier fix where the project asks two people to approve one", () => {
  test.each(EVERYWHERE)(
    "from %s: the first approval is recorded - who, when, where - and nothing runs",
    async (where: Where) => {
      const result: RemediationApprovalResult | WorkspaceAnswer =
        await approveFrom(where, member(MAYA_ID));

      expect(firstWrite).toHaveBeenCalledTimes(1);
      const set: FirstApprovalSet = (
        firstWrite.mock.calls[0]![0] as { set: FirstApprovalSet }
      ).set;
      expect(set.firstApprovedByUserId).toBe(MAYA_ID.toString());
      expect(set.firstApprovedAt).toBeInstanceOf(Date);
      expect(set.firstApprovedFrom).toBe(SOURCE_OF[where]);

      // The fix still waits, and nothing was claimed or run.
      expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
      expect(secondWrite).not.toHaveBeenCalled();
      expect(singleWrite).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();

      if (where === "Dashboard") {
        expect(result).toEqual({
          suggestionId: SUGGESTION_ID.toString(),
          status: AutoRemediationSuggestionStatus.Suggested,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
          isWaitingForSecondApproval: true,
        });
      } else {
        // Told where they pressed: it waits for someone else's approval.
        expect(result).toEqual(
          WorkspaceRemediationActions.getFirstOfTwoApprovedAnswer(
            fixAsReadNow(),
          ),
        );
        expect((result as WorkspaceAnswer).markdown).toBe(
          "✅ You approved this fix. It holds a riskier change, so it runs once someone else approves it too, and the incident in OneUptime shows when it does.",
        );
      }

      /*
       * The feed - and the record's channels, where the fix's message
       * waits - says it needs someone else's approval now.
       */
      expect(feed).toHaveBeenCalledTimes(1);
      const item: Record<string, unknown> = feed.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(item["userId"]).toEqual(MAYA_ID);
      expect(String(item["feedInfoInMarkdown"])).toContain(
        "It holds a riskier change, so it runs once someone else approves it too.",
      );
      expect(
        (item["workspaceNotification"] as Record<string, unknown>)[
          "sendWorkspaceNotification"
        ],
      ).toBe(true);
      if (where !== "Dashboard") {
        expect(String(item["feedInfoInMarkdown"])).toContain(
          where === WorkspaceType.Slack ? "from Slack" : "from Microsoft Teams",
        );
      }
    },
  );

  test.each(EVERYWHERE)(
    "from %s: the person who approved first cannot approve again - refused with why, and nothing runs",
    async (where: Where) => {
      await approveFrom("Dashboard", member(MAYA_ID));
      feed.mockClear();

      const refusal: unknown = await refusalOf(
        approveFrom(where, member(MAYA_ID)),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as Error).message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
      expect(getAlreadyApprovedFirstMessage()).toBe(
        ALREADY_APPROVED_FIRST_MESSAGE,
      );
      // Their first approval stands; nothing more is written or run.
      expect(String(row["firstApprovedByUserId"])).toBe(MAYA_ID.toString());
      expect(firstWrite).toHaveBeenCalledTimes(1);
      expect(secondWrite).not.toHaveBeenCalled();
      expect(singleWrite).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test.each(EVERYWHERE)(
    "from %s: someone else's approval is the second, and runs the fix",
    async (where: Where) => {
      await approveFrom("Dashboard", member(MAYA_ID));
      feed.mockClear();

      const result: RemediationApprovalResult | WorkspaceAnswer =
        await approveFrom(where, member(SAM_ID));

      // Claimed only while Maya's is the first approval and Sam is someone else.
      expect(secondWrite).toHaveBeenCalledTimes(1);
      const args: {
        firstApprovedByUserId: string;
        set: SuggestionTransitionSet;
      } = secondWrite.mock.calls[0]![0] as never;
      expect(args.firstApprovedByUserId).toBe(MAYA_ID.toString());
      expect(args.set.approvedByUserId).toBe(SAM_ID.toString());
      expect(args.set.approvedFrom).toBe(SOURCE_OF[where]);
      expect(singleWrite).not.toHaveBeenCalled();

      expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });

      if (where === "Dashboard") {
        expect(result).toEqual({
          suggestionId: SUGGESTION_ID.toString(),
          status: AutoRemediationSuggestionStatus.Approved,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
        });
      } else {
        expect(result).toEqual(
          WorkspaceRemediationActions.getApprovedAnswer(fixAsReadNow()),
        );
      }

      // The feed names whose approval came first.
      expect(feedMarkdowns()).toHaveLength(1);
      expect(feedMarkdowns()[0]).toContain(
        "after **Maya Chen** approved it first: 1 command is being run.",
      );
    },
  );

  test("a second approval names the first approver plainly when their name cannot be read", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    feed.mockClear();
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);

    await approveFrom("Dashboard", member(SAM_ID));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(feedMarkdowns()[0]).toContain(
      "the second of two approvals: 1 command is being run.",
    );
  });

  test("the first approver can still dismiss the fix", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    await expect(
      RemediationApproval.dismiss({
        props: member(MAYA_ID),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).resolves.toMatchObject({
      status: AutoRemediationSuggestionStatus.Dismissed,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  test("a first approval is held to every check a lone one is: a member who may not edit the account records none", async () => {
    const refusal: unknown = await refusalOf(
      approveFrom("Dashboard", blockedOnProd(MAYA_ID)),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(firstWrite).not.toHaveBeenCalled();
    expect(row["firstApprovedByUserId"]).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  test("a second approver who may not edit the account is refused, and the first approval stands", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));

    const refusal: unknown = await refusalOf(
      approveFrom(WorkspaceType.Slack, blockedOnProd(SAM_ID)),
    );

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(secondWrite).not.toHaveBeenCalled();
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(String(row["firstApprovedByUserId"])).toBe(MAYA_ID.toString());
    expect(execute).not.toHaveBeenCalled();
  });

  test("Enable AI turned off refuses a first approval before anything is recorded", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      enableAi: false,
      requireTwoApprovalsForRiskierFixes: true,
    } as unknown as Project);

    await expect(approveFrom("Dashboard", member(MAYA_ID))).rejects.toThrow(
      "AI is disabled for this project",
    );
    expect(firstWrite).not.toHaveBeenCalled();
  });

  test("two first approvals at once: one is recorded, and the other person's press is the second", async () => {
    // Sam's press is read before Maya's write lands, and loses to it.
    beforeFirstWrite = (): void => {
      row["firstApprovedByUserId"] = MAYA_ID;
      row["firstApprovedAt"] = new Date();
      row["firstApprovedFrom"] = AutoRemediationApprovalSource.Dashboard;
    };

    await approveFrom(WorkspaceType.MicrosoftTeams, member(SAM_ID));

    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).toHaveBeenCalledTimes(1);
    expect(
      (secondWrite.mock.calls[0]![0] as { firstApprovedByUserId: string })
        .firstApprovedByUserId,
    ).toBe(MAYA_ID.toString());
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(String(row["approvedByUserId"])).toBe(SAM_ID.toString());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("one person pressing twice at once: the second press is refused, and nothing runs", async () => {
    // Maya's other press records her first approval while this one is read.
    beforeFirstWrite = (): void => {
      row["firstApprovedByUserId"] = MAYA_ID;
      row["firstApprovedAt"] = new Date();
      row["firstApprovedFrom"] = AutoRemediationApprovalSource.Slack;
    };

    const refusal: unknown = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID)),
    );

    expect((refusal as Error).message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
    expect(secondWrite).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  test("a first approval that loses to a dismissal says the fix was actioned", async () => {
    beforeFirstWrite = (): void => {
      row["status"] = AutoRemediationSuggestionStatus.Dismissed;
    };

    await expect(approveFrom("Dashboard", member(MAYA_ID))).rejects.toThrow(
      "This suggestion was just actioned by someone else.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test("a second approval that loses to another second approval runs nothing more", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    secondWrite.mockResolvedValueOnce(0 as never);

    await expect(approveFrom("Dashboard", member(SAM_ID))).rejects.toThrow(
      "This suggestion was just actioned by someone else.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  test("a change the policy tiers riskier now needs two, whatever the plan stored", async () => {
    row = suggestionRow(planOf(STOP_INSTANCE, ResourceCommandTier.SafeWrite));

    await approveFrom("Dashboard", member(MAYA_ID));

    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("one approval runs a fix, as before", () => {
  test.each(EVERYWHERE)(
    "from %s: with the rule off, a riskier fix runs on one approval (negative control)",
    async (where: Where) => {
      isRuleOn = false;

      await approveFrom(where, member(MAYA_ID));

      expect(firstWrite).not.toHaveBeenCalled();
      expect(secondWrite).not.toHaveBeenCalled();
      expect(singleWrite).toHaveBeenCalledTimes(1);
      expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
      expect(String(row["approvedByUserId"])).toBe(MAYA_ID.toString());
      expect(execute).toHaveBeenCalledTimes(1);
      expect(feedMarkdowns()[0]).toContain("Approved the **AI command plan**");
      expect(feedMarkdowns()[0]).not.toContain("someone else");
    },
  );

  test("with the rule on, a fix of safe changes only runs on one approval", async () => {
    row = suggestionRow(planOf(SCALE_OUT, ResourceCommandTier.SafeWrite));

    await approveFrom(WorkspaceType.Slack, member(MAYA_ID));

    expect(firstWrite).not.toHaveBeenCalled();
    expect(singleWrite).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a rule turned off after a first approval lets the next approval run it, whoever gives it", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    isRuleOn = false;

    await approveFrom("Dashboard", member(MAYA_ID));

    expect(singleWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("the rule is read when the approval is made: one turned on after a fix was proposed holds it", async () => {
    const projectRead: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: PROJECT_ID,
        enableAi: true,
        requireTwoApprovalsForRiskierFixes: true,
      } as unknown as Project) as unknown as jest.SpyInstance;

    await approveFrom("Dashboard", member(SAM_ID));

    // The project is read as the approval is made, for the rule as it is now.
    expect(
      (projectRead.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({
      _id: true,
      enableAi: true,
      requireTwoApprovalsForRiskierFixes: true,
    });
    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("what Slack and Microsoft Teams say about two approvals", () => {
  test("the first approver is told why pressing again does nothing, before any dialog opens", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));

    const answer: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getAlreadyApprovedAnswer({
        suggestion: fixAsReadNow(),
        userId: MAYA_ID,
      });

    expect(answer).toEqual({
      markdown: ALREADY_APPROVED_FIRST_MESSAGE,
      text: "You already approved this fix",
    });
  });

  test("nobody else is, nor the first approver once the rule is off or the fix moved on", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));

    expect(
      await WorkspaceRemediationActions.getAlreadyApprovedAnswer({
        suggestion: fixAsReadNow(),
        userId: SAM_ID,
      }),
    ).toBeNull();

    isRuleOn = false;
    expect(
      await WorkspaceRemediationActions.getAlreadyApprovedAnswer({
        suggestion: fixAsReadNow(),
        userId: MAYA_ID,
      }),
    ).toBeNull();

    isRuleOn = true;
    row["status"] = AutoRemediationSuggestionStatus.Dismissed;
    expect(
      await WorkspaceRemediationActions.getAlreadyApprovedAnswer({
        suggestion: fixAsReadNow(),
        userId: MAYA_ID,
      }),
    ).toBeNull();
  });

  test("the dialog of a first approval says two people must approve, and its press only approves", async () => {
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());

    expect(dialog?.submitTitle).toBe("Approve");
    expect(dialog?.markdown).toContain(
      "This fix holds a riskier change, so two people must approve it, and yours is the first. It runs once someone else approves it too.",
    );
    expect(dialog?.markdown).not.toContain("Approving runs exactly");
    // Microsoft Teams' card says it as its last part.
    expect(dialog?.teamsParts[dialog.teamsParts.length - 1]).toBe(
      "This fix holds a riskier change, so two people must approve it, and yours is the first. It runs once someone else approves it too.",
    );
  });

  test("the dialog of a second approval names whose came first, and its press runs the fix", async () => {
    await approveFrom(WorkspaceType.Slack, member(MAYA_ID));

    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());

    expect(dialog?.submitTitle).toBe("Approve and run");
    expect(dialog?.markdown).toContain(
      "**Maya Chen** approved this fix first. Approving it too runs exactly what is shown, under your name.",
    );
    expect(dialog?.teamsParts[dialog.teamsParts.length - 1]).toContain(
      "**Maya Chen** approved this fix first.",
    );
  });

  test("with the rule off, the dialog reads as it always has", async () => {
    isRuleOn = false;

    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());

    expect(dialog?.submitTitle).toBe("Approve and run");
    expect(dialog?.markdown).toContain(
      "Approving runs exactly what is shown, under your name.",
    );
    expect(dialog?.markdown).not.toContain("two people");
  });
});
