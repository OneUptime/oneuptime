import RemediationApproval, {
  ApprovalStepChangedException,
  getApproverMustBeAPersonMessage,
  getFixChangedSinceMessage,
  getFixChangedSinceShownMessage,
  getFixKeepsChangingMessage,
  getJustActionedMessage,
  getUnknownApprovalStepMessage,
  MAX_APPROVAL_ATTEMPTS,
  RemediationApprovalResult,
} from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import McpRemediationRunner from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import RemediationChatMessage, {
  RemediationActionValue,
} from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import ExternalMcpServerService from "../../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import UserService from "../../../../Server/Services/UserService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Incident from "../../../../Models/DatabaseModels/Incident";
import User from "../../../../Models/DatabaseModels/User";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import { ExternalMcpToolCallStatus } from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import {
  ALREADY_APPROVED_FIRST_MESSAGE,
  encodeRemediationApprovalStep,
  RemediationApprovalStepKind,
} from "../../../../Types/AutoRemediation/RemediationApprovals";
import { getRemediationPlanFingerprint } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
import PrivateRecordWriteCheck from "../../../../Server/Utils/Permission/PrivateRecordWriteCheck";

/*
 * AN APPROVAL IS BOUND TO THE EXACT FIX IT APPROVES (#6421, #6422).
 *
 * The security properties of approving a fix OneUptime AI proposes, played
 * out against one in-memory row whose conditional UPDATEs are evaluated the
 * way Postgres evaluates their WHERE clauses - the service's real
 * attemptStatusTransition, attemptFirstApproval and attemptSecondApproval,
 * with a repository that applies each clause it is sent (and fails a test
 * on any clause it does not know). Every write moves the row's version on,
 * as the @VersionColumn does, and every read is a copy of the row as it was
 * then. Two presses "at once" run concurrently and meet at the database: a
 * barrier holds each write until both presses reach theirs, so both read
 * and check the fix before either lands.
 *
 * Pinned, each with its negative:
 *
 *   - no approving one plan and running another: a press names the plan it
 *     was shown (the card's and the chats' fingerprints), a plan written
 *     between an approval's checks and its claim is never claimed by them,
 *     and a first approval counts only for the plan it approved;
 *   - the same person is never both approvers, from the Dashboard, Slack,
 *     Microsoft Teams or the API, in any order and at once;
 *   - two approvals racing never run a plan twice, nor skip the second;
 *   - a dialog left open while what its press does changed does nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000003",
);
const CLOUD_ACCOUNT_ID: string = "9d000000-0000-4000-8000-000000000004";
const AGENT_ID: string = "9d000000-0000-4000-8000-000000000005";
const OTHER_ACCOUNT_ID: string = "9d000000-0000-4000-8000-000000000006";
const MCP_SERVER_ID: string = "9d000000-0000-4000-8000-000000000007";
const MAYA_ID: ObjectID = new ObjectID("9d000000-0000-4000-8000-0000000000aa");
const SAM_ID: ObjectID = new ObjectID("9d000000-0000-4000-8000-0000000000bb");
const LEE_ID: ObjectID = new ObjectID("9d000000-0000-4000-8000-0000000000cc");

const NAMES: Record<string, string> = {
  [MAYA_ID.toString()]: "Maya Chen",
  [SAM_ID.toString()]: "Sam Lee",
  [LEE_ID.toString()]: "Lee Park",
};

// A riskier change (RiskyWrite) and a safe one (SafeWrite).
const STOP_INSTANCE: string =
  "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0123456789abcdef0";
const TERMINATE_OTHER: string =
  "cloud stop-instance arn:aws:ec2:us-east-1:123456789012:instance/i-0fedcba9876543210";
const SCALE_OUT: string =
  "cloud scale-out arn:aws:ecs:us-east-1:123456789012:service/prod/web --count 8";

type Where = "Dashboard" | WorkspaceType.Slack | WorkspaceType.MicrosoftTeams;

const EVERYWHERE: Array<Where> = [
  "Dashboard",
  WorkspaceType.Slack,
  WorkspaceType.MicrosoftTeams,
];

function member(userId: ObjectID | string): DatabaseCommonInteractionProps {
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
    userId: typeof userId === "string" ? new ObjectID(userId) : userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function planOf(
  commandText: string,
  tier: ResourceCommandTier,
  resourceId: string = CLOUD_ACCOUNT_ID,
): JSONObject {
  return {
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.ResourceCommand,
        runnerId: AGENT_ID,
        runnerNameSnapshot: "Cloud AI agent",
        resourceType: AiResourceType.AwsAccount,
        resourceId,
        resourceNameSnapshot: "prod",
        resourceCommandTier: tier,
        command: commandText,
        timeoutInMs: 60000,
        rationale: "the instance is wedged",
        expectedEffect: "the load balancer drains it",
        policyVerdict: "RequiresApproval",
      },
    ],
  } as JSONObject;
}

const RISKIER_PLAN: JSONObject = planOf(
  STOP_INSTANCE,
  ResourceCommandTier.RiskyWrite,
);
const OTHER_RISKIER_PLAN: JSONObject = planOf(
  TERMINATE_OTHER,
  ResourceCommandTier.RiskyWrite,
);
const SAFE_PLAN: JSONObject = planOf(SCALE_OUT, ResourceCommandTier.SafeWrite);

/*
 * ------------------------------------------------------------------
 * One row, and the conditional UPDATEs, as Postgres would apply them.
 * ------------------------------------------------------------------
 */
type Row = Record<string, unknown>;

let row: Row;

function lower(value: unknown): string {
  return value === undefined || value === null
    ? ""
    : String(value).toLowerCase();
}

/*
 * Each WHERE clause the service sends, as a predicate on the row. A clause
 * not listed here fails the test: what the fake does not model, it never
 * guesses.
 */
const CLAUSES: Record<string, (params: Record<string, unknown>) => boolean> = {
  '"_id" = :id': (params: Record<string, unknown>): boolean => {
    return lower(row["_id"]) === lower(params["id"]);
  },
  '"status" = :status': (params: Record<string, unknown>): boolean => {
    return row["status"] === params["status"];
  },
  '"status" = :fromStatus': (params: Record<string, unknown>): boolean => {
    return row["status"] === params["fromStatus"];
  },
  '"version" = :version': (params: Record<string, unknown>): boolean => {
    return row["version"] === params["version"];
  },
  '"deletedAt" IS NULL': (): boolean => {
    return !row["deletedAt"];
  },
  '("firstApprovedByUserId" IS NULL OR "firstApprovedPlanFingerprint" IS DISTINCT FROM :planFingerprint)':
    (params: Record<string, unknown>): boolean => {
      return (
        !row["firstApprovedByUserId"] ||
        (row["firstApprovedPlanFingerprint"] ?? null) !==
          (params["planFingerprint"] ?? null)
      );
    },
  '"firstApprovedByUserId" = :firstApprovedByUserId': (
    params: Record<string, unknown>,
  ): boolean => {
    return (
      Boolean(row["firstApprovedByUserId"]) &&
      lower(row["firstApprovedByUserId"]) ===
        lower(params["firstApprovedByUserId"])
    );
  },
  '"firstApprovedPlanFingerprint" = :planFingerprint': (
    params: Record<string, unknown>,
  ): boolean => {
    return (
      row["firstApprovedPlanFingerprint"] !== undefined &&
      row["firstApprovedPlanFingerprint"] !== null &&
      row["firstApprovedPlanFingerprint"] === params["planFingerprint"]
    );
  },
  '"firstApprovedByUserId" <> :approverId': (
    params: Record<string, unknown>,
  ): boolean => {
    return (
      Boolean(row["firstApprovedByUserId"]) &&
      lower(row["firstApprovedByUserId"]) !== lower(params["approverId"])
    );
  },
};

// Every conditional UPDATE sent, and whether it landed.
interface SentUpdate {
  set: Record<string, unknown>;
  clauses: Array<string>;
  landed: boolean;
}

let updates: Array<SentUpdate>;

/*
 * Writes wait here until this many presses have reached theirs, so two
 * presses "at once" both read and check the fix before either lands. Zero:
 * no wait.
 */
let writersToWaitFor: number;
let writersArrived: number;
let releaseWriters: (() => void) | null;
let writersReleased: Promise<void>;

function waitForWriters(count: number): void {
  writersToWaitFor = count;
  writersArrived = 0;
  writersReleased = new Promise<void>((resolve: () => void) => {
    releaseWriters = resolve;
  });
}

async function atTheDatabase(): Promise<void> {
  if (writersToWaitFor <= 0) {
    return;
  }

  writersArrived++;

  if (writersArrived >= writersToWaitFor) {
    writersToWaitFor = 0;
    releaseWriters?.();
  }

  await writersReleased;
}

function fakeRepository(): unknown {
  return {
    createQueryBuilder: (): unknown => {
      let set: Record<string, unknown> = {};
      const wheres: Array<{
        clause: string;
        params: Record<string, unknown>;
      }> = [];

      const builder: Record<string, unknown> = {
        update: (): unknown => {
          return builder;
        },
        set: (values: Record<string, unknown>): unknown => {
          set = values;
          return builder;
        },
        where: (clause: string, params?: Record<string, unknown>): unknown => {
          wheres.push({ clause, params: params || {} });
          return builder;
        },
        andWhere: (
          clause: string,
          params?: Record<string, unknown>,
        ): unknown => {
          wheres.push({ clause, params: params || {} });
          return builder;
        },
        execute: async (): Promise<{ affected: number }> => {
          await atTheDatabase();

          const landed: boolean = wheres.every(
            (where: {
              clause: string;
              params: Record<string, unknown>;
            }): boolean => {
              const predicate:
                | ((params: Record<string, unknown>) => boolean)
                | undefined = CLAUSES[where.clause];

              if (!predicate) {
                throw new Error(`The fake has no model of: ${where.clause}`);
              }

              return predicate(where.params);
            },
          );

          updates.push({
            set: { ...set },
            clauses: wheres.map((where: { clause: string }): string => {
              return where.clause;
            }),
            landed,
          });

          if (!landed) {
            return { affected: 0 };
          }

          Object.assign(row, set);
          row["version"] = Number(row["version"]) + 1;
          return { affected: 1 };
        },
      };

      return builder;
    },
  };
}

// The row as a read picks it: a copy, with its ids as ObjectIDs.
function readRow(select: Record<string, unknown>): AutoRemediationSuggestion {
  const picked: Record<string, unknown> = { id: row["id"] };

  for (const key of Object.keys(select)) {
    if (!(key in row)) {
      continue;
    }

    const value: unknown = row[key];

    picked[key] =
      (key === "firstApprovedByUserId" || key === "approvedByUserId") &&
      typeof value === "string"
        ? new ObjectID(value)
        : value && typeof value === "object" && !(value instanceof ObjectID)
          ? JSON.parse(JSON.stringify(value))
          : value;
  }

  return picked as unknown as AutoRemediationSuggestion;
}

function suggestionRow(
  plan: JSONObject = RISKIER_PLAN,
  overrides: Row = {},
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
    version: 3,
    ...overrides,
  };
}

function mcpRow(): Row {
  return suggestionRow(RISKIER_PLAN, {
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    commandPlan: undefined,
    mcpToolCallPlan: {
      calls: [
        {
          sequence: 1,
          serverId: MCP_SERVER_ID,
          serverNameSnapshot: "Feature flags",
          toolName: "set_flag",
          arguments: { flag: "checkout-db-pool-v2", enabled: false },
          status: ExternalMcpToolCallStatus.Proposed,
        },
      ],
    },
  });
}

// A write by something other than an approval: the row moves on.
function somethingElseWrites(changes: Row): void {
  Object.assign(row, changes);
  row["version"] = Number(row["version"]) + 1;
}

function cloudStatus(resourceId: string): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.AwsAccount,
    resourceId,
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

let isRuleOn: boolean;
let execute: jest.SpyInstance;
let makeChanges: jest.SpyInstance;
let feed: jest.SpyInstance;
// Called while an approval checks the fix: after its read, before its claim.
let duringChecks: (() => void) | null;

beforeEach(() => {
  withLabelJoinTables();
  row = suggestionRow();
  isRuleOn = true;
  updates = [];
  writersToWaitFor = 0;
  duringChecks = null;

  jest
    .spyOn(AutoRemediationSuggestionService, "getRepository")
    .mockImplementation((): never => {
      return fakeRepository() as never;
    });

  jest
    .spyOn(AutoRemediationSuggestionService, "findOneById")
    .mockImplementation(async (args: unknown): Promise<never> => {
      await Promise.resolve();
      return readRow(
        (args as { select: Record<string, unknown> }).select,
      ) as never;
    });

  execute = jest
    .spyOn(CommandPlanExecutor, "executeApprovedPlan")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
  makeChanges = jest
    .spyOn(McpRemediationRunner, "executeApprovedCalls")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

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
    .mockImplementation(async (args: unknown): Promise<never> => {
      if (duringChecks) {
        const write: () => void = duringChecks;
        duringChecks = null;
        write();
      }

      return cloudStatus(
        String((args as { resourceId: ObjectID }).resourceId),
      ) as never;
    });
  jest
    .spyOn(CloudAccountService, "findOneBy")
    .mockImplementation(async (args: unknown): Promise<never> => {
      const query: Record<string, unknown> = (
        args as { query: Record<string, unknown> }
      ).query;
      const model: CloudAccount = new CloudAccount();
      model.id = new ObjectID(String(query["_id"] || CLOUD_ACCOUNT_ID));
      model.projectId = PROJECT_ID;
      model.labels = [];
      return model as never;
    });
  jest
    .spyOn(ExternalMcpServerService, "findServersForRun")
    .mockImplementation(async (): Promise<never> => {
      const server: ExternalMcpServer = new ExternalMcpServer();
      server.id = new ObjectID(MCP_SERVER_ID);
      server.name = "Feature flags";
      return [server] as never;
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
      const name: string | undefined =
        NAMES[String((args as { id: ObjectID }).id).toLowerCase()];

      if (!name) {
        return null as never;
      }

      const user: User = new User();
      user.name = new Name(name);
      return user as never;
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

  for (const [key, value] of Object.entries(
    readRow(
      Object.fromEntries(
        Object.keys(row).map((key: string) => {
          return [key, true];
        }),
      ),
    ),
  )) {
    (suggestion as unknown as Record<string, unknown>)[key] = value;
  }

  return suggestion;
}

function fingerprintNow(): string {
  return getRemediationPlanFingerprint(
    row as unknown as AutoRemediationSuggestion,
  );
}

/*
 * A press of Approve, from where the person is: the card's Approve with the
 * fingerprint of the fix it shows (and the step, when given), or a chat
 * dialog's Approve and run with the value the dialog was opened with.
 */
async function approveFrom(
  where: Where | "API",
  props: DatabaseCommonInteractionProps,
  shown?: { fingerprint?: string; step?: string },
): Promise<RemediationApprovalResult | unknown> {
  if (where === "API") {
    return await RemediationApproval.approve({
      props,
      suggestionId: SUGGESTION_ID.toString(),
    });
  }

  if (where === "Dashboard") {
    return await RemediationApproval.approve({
      props,
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: shown?.fingerprint ?? fingerprintNow(),
      ...(shown?.step ? { expectedApprovalStep: shown.step } : {}),
    });
  }

  const value: RemediationActionValue = {
    suggestionId: SUGGESTION_ID,
    fingerprint: shown?.fingerprint ?? fingerprintNow(),
    ...(shown?.step ? { approvalStep: shown.step } : {}),
  };

  return await WorkspaceRemediationActions.approve({
    props,
    value,
    from: where,
    suggestion: fixAsReadNow(),
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<Error | null> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  return null;
}

function landedUpdates(): Array<SentUpdate> {
  return updates.filter((update: SentUpdate): boolean => {
    return update.landed;
  });
}

const FIRST: string = encodeRemediationApprovalStep({
  kind: RemediationApprovalStepKind.First,
});
const ONLY: string = encodeRemediationApprovalStep({
  kind: RemediationApprovalStepKind.Only,
});

function secondAfter(userId: ObjectID): string {
  return encodeRemediationApprovalStep({
    kind: RemediationApprovalStepKind.Second,
    firstApprovedByUserId: userId.toString(),
  });
}

/*
 * The fixes here are for incidents and alerts that are not private, or that
 * the person reaches: what a fix's buttons ask of a private record's owning
 * teams (#8913) is RemediationPrivateRecord's own suite.
 */
beforeEach(() => {
  jest.spyOn(PrivateRecordWriteCheck, "reaches").mockResolvedValue(true);
});

describe("no approving one plan and running another", () => {
  test("the card's Approve of a plan that changed since it was shown does nothing", async () => {
    const shown: string = fingerprintNow();
    somethingElseWrites({ commandPlan: OTHER_RISKIER_PLAN });

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID), { fingerprint: shown }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(getFixChangedSinceShownMessage());
    expect(updates).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams])(
    "a %s press of a plan that changed since its message was posted does nothing",
    async (where: WorkspaceType) => {
      const posted: string = fingerprintNow();
      somethingElseWrites({ commandPlan: OTHER_RISKIER_PLAN });

      const refusal: Error | null = await refusalOf(
        approveFrom(where as Where, member(MAYA_ID), { fingerprint: posted }),
      );

      expect(refusal?.message).toBe(getFixChangedSinceMessage());
      expect(updates).toEqual([]);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test("a plan written between an approval's checks and its claim is never claimed by them: a safe plan swapped for a riskier one is held for two approvals", async () => {
    isRuleOn = true;
    row = suggestionRow(SAFE_PLAN);
    // While the approval checks the safe plan, a riskier one replaces it.
    duringChecks = (): void => {
      somethingElseWrites({ commandPlan: RISKIER_PLAN });
    };

    const result: unknown = await approveFrom("API", member(MAYA_ID));

    // The claim on the version the checks read missed; the fix was read and checked again.
    expect(updates[0]).toMatchObject({ landed: false });
    expect(updates[0]!.clauses).toContain('"version" = :version');
    // Read again, the plan holds a riskier change: this press is its first approval.
    expect(result).toMatchObject({ isWaitingForSecondApproval: true });
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(row["firstApprovedPlanFingerprint"]).toBe(fingerprintNow());
    expect(execute).not.toHaveBeenCalled();
  });

  test("the same swap with the card's fingerprint is refused outright: what the person saw is not what runs", async () => {
    row = suggestionRow(SAFE_PLAN);
    const shown: string = fingerprintNow();
    duringChecks = (): void => {
      somethingElseWrites({ commandPlan: RISKIER_PLAN });
    };

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID), { fingerprint: shown }),
    );

    expect(refusal?.message).toBe(getFixChangedSinceShownMessage());
    expect(landedUpdates()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  test("negative control: with no write in between, the claim lands on the version read, and the plan checked is the one that runs", async () => {
    isRuleOn = false;
    const versionRead: unknown = row["version"];
    const planChecked: string = fingerprintNow();

    await approveFrom("Dashboard", member(MAYA_ID));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ landed: true });
    expect(row["version"]).toBe(Number(versionRead) + 1);
    expect(fingerprintNow()).toBe(planChecked);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a dry run's answer landing meanwhile only makes the approval read the fix again: the same plan, approved and run once", async () => {
    isRuleOn = false;
    duringChecks = (): void => {
      const plan: JSONObject = JSON.parse(JSON.stringify(row["commandPlan"]));
      (plan["commands"] as Array<JSONObject>)[0]!["dryRun"] = {
        status: "WouldRun",
        checkedAt: "2026-11-16T10:00:00.000Z",
      };
      somethingElseWrites({ commandPlan: plan });
    };

    await approveFrom("Dashboard", member(MAYA_ID));

    expect(
      updates.map((update: SentUpdate) => {
        return update.landed;
      }),
    ).toEqual([false, true]);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test(`a fix that keeps changing is not approved: after ${MAX_APPROVAL_ATTEMPTS} reads the approval gives up, and nothing runs`, async () => {
    isRuleOn = false;
    // Every claim finds the fix written again since its checks read it.
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockImplementation(async (args: unknown): Promise<never> => {
        somethingElseWrites({});
        return cloudStatus(
          String((args as { resourceId: ObjectID }).resourceId),
        ) as never;
      });

    const refusal: Error | null = await refusalOf(
      approveFrom("API", member(MAYA_ID)),
    );

    expect(refusal?.message).toBe(getFixKeepsChangingMessage());
    expect(updates).toHaveLength(MAX_APPROVAL_ATTEMPTS);
    expect(landedUpdates()).toEqual([]);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(execute).not.toHaveBeenCalled();
  });

  test("a fix read without its version is not approved (fails closed)", async () => {
    delete row["version"];

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID)),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toContain("could not read this fix as it stands");
    expect(updates).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  test("the first approval records the plan it approved", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));

    expect(row["firstApprovedByUserId"]).toBe(MAYA_ID.toString());
    expect(row["firstApprovedPlanFingerprint"]).toBe(fingerprintNow());
    expect(execute).not.toHaveBeenCalled();
  });

  test("a first approval given to another plan counts for nothing: the next press is the first approval of the plan as it is, and nothing runs", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    // The plan Maya approved is replaced by one nobody approved.
    somethingElseWrites({ commandPlan: OTHER_RISKIER_PLAN });

    const result: unknown = await approveFrom(
      WorkspaceType.Slack,
      member(SAM_ID),
    );

    expect(result).toEqual(
      WorkspaceRemediationActions.getFirstOfTwoApprovedAnswer(),
    );
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(row["firstApprovedByUserId"]).toBe(SAM_ID.toString());
    expect(row["firstApprovedPlanFingerprint"]).toBe(fingerprintNow());
    expect(execute).not.toHaveBeenCalled();

    // Two people approving the plan as it is now runs it - Maya may be the second.
    await approveFrom("Dashboard", member(MAYA_ID));

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(row["approvedByUserId"]).toBe(MAYA_ID.toString());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a second approval's claim names the plan the first approved: one recorded for another plan never lets it land", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    // As if the first approval had been recorded for another plan, after the read.
    duringChecks = (): void => {
      somethingElseWrites({ firstApprovedPlanFingerprint: "ffffffffffffffff" });
    };

    await approveFrom("Dashboard", member(SAM_ID));

    // Sam's second-approval claim missed; read again, his press is a new first approval.
    const secondClaims: Array<SentUpdate> = updates.filter(
      (update: SentUpdate): boolean => {
        return update.clauses.includes(
          '"firstApprovedPlanFingerprint" = :planFingerprint',
        );
      },
    );
    expect(secondClaims).toHaveLength(1);
    expect(secondClaims[0]!.landed).toBe(false);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(row["firstApprovedByUserId"]).toBe(SAM_ID.toString());
    expect(execute).not.toHaveBeenCalled();
  });

  test("a first approval given before what it approved was kept counts for nothing", async () => {
    row = suggestionRow(RISKIER_PLAN, {
      firstApprovedByUserId: MAYA_ID.toString(),
      firstApprovedAt: new Date("2026-11-10T09:00:00.000Z"),
      firstApprovedFrom: "Dashboard",
    });

    const result: unknown = await approveFrom("Dashboard", member(SAM_ID));

    expect(result).toMatchObject({ isWaitingForSecondApproval: true });
    expect(row["firstApprovedByUserId"]).toBe(SAM_ID.toString());
    expect(execute).not.toHaveBeenCalled();
  });

  test("the dialog of such a fix says yours is the first, and its press is offered as the first", async () => {
    row = suggestionRow(RISKIER_PLAN, {
      firstApprovedByUserId: MAYA_ID.toString(),
      firstApprovedPlanFingerprint: "ffffffffffffffff",
    });

    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());

    expect(dialog?.submitTitle).toBe("Approve");
    expect(dialog?.markdown).toContain("yours is the first");
    expect(
      RemediationChatMessage.decodeActionValue(dialog?.value)?.approvalStep,
    ).toBe(FIRST);
  });
});

describe("the same person is never both approvers", () => {
  const pairs: Array<[Where | "API", Where | "API"]> = [];

  for (const first of [...EVERYWHERE, "API" as const]) {
    for (const second of [...EVERYWHERE, "API" as const]) {
      pairs.push([first, second]);
    }
  }

  test.each(pairs)(
    "approved first from %s, again from %s: refused with why, and nothing runs",
    async (first: Where | "API", second: Where | "API") => {
      await approveFrom(first, member(MAYA_ID));
      expect(row["firstApprovedByUserId"]).toBe(MAYA_ID.toString());
      const versionAfterFirst: unknown = row["version"];

      const refusal: Error | null = await refusalOf(
        approveFrom(second, member(MAYA_ID)),
      );

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal?.message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
      expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
      expect(row["version"]).toBe(versionAfterFirst);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  test("the same id in other letters is the same person", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));

    const refusal: Error | null = await refusalOf(
      approveFrom(
        WorkspaceType.Slack,
        member(MAYA_ID.toString().toUpperCase()),
      ),
    );

    expect(refusal?.message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
    expect(execute).not.toHaveBeenCalled();
  });

  test("the first approver pressing a dialog offered as the first approval is told they approved already, not that someone else did", async () => {
    await approveFrom(WorkspaceType.MicrosoftTeams, member(MAYA_ID));

    const refusal: Error | null = await refusalOf(
      approveFrom(WorkspaceType.Slack, member(MAYA_ID), { step: FIRST }),
    );

    expect(refusal?.message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
    expect(refusal).not.toBeInstanceOf(ApprovalStepChangedException);
    expect(execute).not.toHaveBeenCalled();
  });

  test("an approval with no person behind it is refused before anything is read or written", async () => {
    const props: DatabaseCommonInteractionProps = member(MAYA_ID);
    delete props.userId;
    props.userType = UserType.API;

    const refusal: Error | null = await refusalOf(
      RemediationApproval.approve({
        props,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    );

    expect(refusal?.message).toBe(getApproverMustBeAPersonMessage());
    expect(AutoRemediationSuggestionService.findOneById).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  test("one person's two presses at once, from two places: one first approval, the other refused, nothing runs", async () => {
    waitForWriters(2);

    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled([
        approveFrom("Dashboard", member(MAYA_ID)),
        approveFrom(WorkspaceType.Slack, member(MAYA_ID)),
      ]);

    const refused: Array<PromiseRejectedResult> = results.filter(
      (result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "rejected";
      },
    ) as Array<PromiseRejectedResult>;

    expect(refused).toHaveLength(1);
    expect((refused[0]!.reason as Error).message).toBe(
      ALREADY_APPROVED_FIRST_MESSAGE,
    );
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(row["firstApprovedByUserId"]).toBe(MAYA_ID.toString());
    expect(landedUpdates()).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("two approvals racing never run a plan twice, nor skip the second", () => {
  test("two people's first presses at once: one is the first, the other the second, and the plan runs once", async () => {
    waitForWriters(2);

    await Promise.all([
      approveFrom("Dashboard", member(MAYA_ID)),
      approveFrom(WorkspaceType.MicrosoftTeams, member(SAM_ID)),
    ]);

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    // Two different people: the first approval and the second.
    expect(lower(row["firstApprovedByUserId"])).not.toBe(
      lower(row["approvedByUserId"]),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("two second approvals at once: one claims the fix, the other is told it was actioned, and the plan runs once", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    waitForWriters(2);

    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled([
        approveFrom(WorkspaceType.Slack, member(SAM_ID)),
        approveFrom(WorkspaceType.MicrosoftTeams, member(LEE_ID)),
      ]);

    expect(
      results.filter((result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "fulfilled";
      }),
    ).toHaveLength(1);
    const refused: PromiseRejectedResult = results.find(
      (result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "rejected";
      },
    ) as PromiseRejectedResult;
    expect((refused.reason as Error).message).toContain(
      getJustActionedMessage(),
    );
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("with the rule off, two approvals at once run the plan once", async () => {
    isRuleOn = false;
    waitForWriters(2);

    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled([
        approveFrom("Dashboard", member(MAYA_ID)),
        approveFrom(WorkspaceType.Slack, member(SAM_ID)),
      ]);

    expect(
      results.filter((result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "rejected";
      }),
    ).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a press read before someone else's first approval landed is never run as a lone approval", async () => {
    // Sam's press reads no first approval; Maya's lands while he is checked.
    duringChecks = (): void => {
      somethingElseWrites({
        firstApprovedByUserId: MAYA_ID.toString(),
        firstApprovedAt: new Date(),
        firstApprovedFrom: "Slack",
        firstApprovedPlanFingerprint: fingerprintNow(),
      });
    };

    await approveFrom("API", member(SAM_ID));

    // His first-approval claim missed; read again, his press is the second.
    expect(updates[0]).toMatchObject({ landed: false });
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(row["approvedByUserId"]).toBe(SAM_ID.toString());
    expect(row["firstApprovedByUserId"]).toBe(MAYA_ID.toString());
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a first approval racing a dismissal: nothing runs, and the press is told the fix was actioned", async () => {
    duringChecks = (): void => {
      somethingElseWrites({
        status: AutoRemediationSuggestionStatus.Dismissed,
      });
    };

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID)),
    );

    expect(refusal?.message).toBe(getJustActionedMessage());
    expect(landedUpdates()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("a dialog left open while what its press does changed does nothing", () => {
  test("opened as the first of two, pressed after someone else approved first: nothing is done, and the person reviews it again", async () => {
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());
    const offered: RemediationActionValue | null =
      RemediationChatMessage.decodeActionValue(dialog?.value);
    expect(offered?.approvalStep).toBe(FIRST);

    // Sam approves first while Lee's dialog is open.
    await approveFrom("Dashboard", member(SAM_ID));
    const versionBefore: unknown = row["version"];

    for (const where of [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]) {
      const refusal: Error | null = await refusalOf(
        WorkspaceRemediationActions.approve({
          props: member(LEE_ID),
          value: offered!,
          from: where,
          suggestion: fixAsReadNow(),
        }),
      );

      expect(refusal).toBeInstanceOf(ApprovalStepChangedException);
      expect(refusal?.message).toBe(
        "Sam Lee approved this fix while you were reviewing it, so approving it now would run it. Nothing was done: review it again before you approve.",
      );
    }

    expect(row["version"]).toBe(versionBefore);
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(execute).not.toHaveBeenCalled();

    // Reviewed again, the dialog says whose came first, and its press runs the fix.
    const fresh: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());
    expect(fresh?.submitTitle).toBe("Approve and run");
    expect(fresh?.markdown).toContain("**Sam Lee** approved this fix first.");
    expect(
      RemediationChatMessage.decodeActionValue(fresh?.value)?.approvalStep,
    ).toBe(secondAfter(SAM_ID));

    await WorkspaceRemediationActions.approve({
      props: member(LEE_ID),
      value: RemediationChatMessage.decodeActionValue(fresh?.value)!,
      from: WorkspaceType.Slack,
      suggestion: fixAsReadNow(),
    });

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("opened when one approval ran it, pressed after the rule was turned on: nothing is recorded", async () => {
    isRuleOn = false;
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());
    expect(
      RemediationChatMessage.decodeActionValue(dialog?.value)?.approvalStep,
    ).toBe(ONLY);
    isRuleOn = true;

    const refusal: Error | null = await refusalOf(
      WorkspaceRemediationActions.approve({
        props: member(MAYA_ID),
        value: RemediationChatMessage.decodeActionValue(dialog?.value)!,
        from: WorkspaceType.Slack,
        suggestion: fixAsReadNow(),
      }),
    );

    expect(refusal).toBeInstanceOf(ApprovalStepChangedException);
    expect(refusal?.message).toBe(
      "This fix now needs two people to approve it, and yours would be the first. Nothing was done: review it again before you approve.",
    );
    expect(updates).toEqual([]);
  });

  test("opened as the first of two, pressed after the rule was turned off: it is not run on what the dialog called a first approval", async () => {
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());
    isRuleOn = false;

    const refusal: Error | null = await refusalOf(
      WorkspaceRemediationActions.approve({
        props: member(MAYA_ID),
        value: RemediationChatMessage.decodeActionValue(dialog?.value)!,
        from: WorkspaceType.MicrosoftTeams,
        suggestion: fixAsReadNow(),
      }),
    );

    expect(refusal?.message).toBe(
      "One approval now runs this fix, so yours would run it. Nothing was done: review it again before you approve.",
    );
    expect(updates).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  test("the card's Approve offered as the first approval does nothing once someone else approved first", async () => {
    await approveFrom(WorkspaceType.Slack, member(SAM_ID));

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(LEE_ID), { step: FIRST }),
    );

    expect(refusal).toBeInstanceOf(ApprovalStepChangedException);
    expect(execute).not.toHaveBeenCalled();
  });

  test("negative control: a press offered as what it still is acts", async () => {
    await approveFrom(WorkspaceType.Slack, member(SAM_ID));

    await approveFrom("Dashboard", member(LEE_ID), {
      step: secondAfter(SAM_ID),
    });

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a press offered as the second after someone who is no longer the first approver does nothing", async () => {
    await approveFrom(WorkspaceType.Slack, member(SAM_ID));

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(LEE_ID), {
        step: secondAfter(MAYA_ID),
      }),
    );

    expect(refusal).toBeInstanceOf(ApprovalStepChangedException);
    expect(execute).not.toHaveBeenCalled();
  });

  test.each([
    "second",
    "second:",
    "second:not an id",
    "third",
    "x".repeat(80),
    42,
  ])(
    "a press that says it was offered as %j is refused",
    async (step: unknown) => {
      const refusal: Error | null = await refusalOf(
        RemediationApproval.approve({
          props: member(MAYA_ID),
          suggestionId: SUGGESTION_ID.toString(),
          expectedApprovalStep: step,
        }),
      );

      expect(refusal?.message).toBe(getUnknownApprovalStepMessage());
      expect(updates).toEqual([]);
    },
  );
});

describe("a fix through MCP servers is held to two approvals where the project asks for them", () => {
  beforeEach(() => {
    row = mcpRow();
  });

  test("its first approval is recorded and nothing is made; someone else's second makes the changes once", async () => {
    const first: unknown = await approveFrom("Dashboard", member(MAYA_ID));

    expect(first).toEqual({
      suggestionId: SUGGESTION_ID.toString(),
      status: AutoRemediationSuggestionStatus.Suggested,
      suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      isWaitingForSecondApproval: true,
    });
    expect(makeChanges).not.toHaveBeenCalled();
    expect(String(feed.mock.calls[0]![0]["feedInfoInMarkdown"])).toContain(
      "so its changes are made once someone else approves it too",
    );

    await approveFrom(WorkspaceType.Slack, member(SAM_ID));

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(makeChanges).toHaveBeenCalledTimes(1);
    expect(String(feed.mock.calls[1]![0]["feedInfoInMarkdown"])).toContain(
      "after **Maya Chen** approved it first (1 change)",
    );
  });

  test("its first approver cannot approve it again", async () => {
    await approveFrom(WorkspaceType.MicrosoftTeams, member(MAYA_ID));

    const refusal: Error | null = await refusalOf(
      approveFrom("Dashboard", member(MAYA_ID)),
    );

    expect(refusal?.message).toBe(ALREADY_APPROVED_FIRST_MESSAGE);
    expect(makeChanges).not.toHaveBeenCalled();
  });

  test("negative control: with the rule off, one approval makes its changes", async () => {
    isRuleOn = false;

    await approveFrom("Dashboard", member(MAYA_ID));

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(makeChanges).toHaveBeenCalledTimes(1);
  });

  test("its dialog says two people must approve it", async () => {
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fixAsReadNow());

    expect(dialog?.submitTitle).toBe("Approve");
    expect(dialog?.markdown).toContain("two people must approve it");
  });
});

describe("what a lone approval does, as before", () => {
  test("a safe plan in a project that asks for two runs on one approval", async () => {
    row = suggestionRow(SAFE_PLAN);

    await approveFrom(WorkspaceType.Slack, member(MAYA_ID), { step: ONLY });

    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("a plan in another account is checked as the plan it is: a second approval of it is checked for its own account", async () => {
    await approveFrom("Dashboard", member(MAYA_ID));
    const accountsChecked: Array<string> = [];
    jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const id: string = String(
          (args as { resourceId: ObjectID }).resourceId,
        );
        accountsChecked.push(id);
        return cloudStatus(id) as never;
      });
    somethingElseWrites({
      commandPlan: planOf(
        STOP_INSTANCE,
        ResourceCommandTier.RiskyWrite,
        OTHER_ACCOUNT_ID,
      ),
    });

    await approveFrom("API", member(SAM_ID));

    expect(accountsChecked).toContain(OTHER_ACCOUNT_ID);
    // Maya approved the plan in the first account, not this one: Sam's is a first approval.
    expect(row["status"]).toBe(AutoRemediationSuggestionStatus.Suggested);
    expect(row["firstApprovedByUserId"]).toBe(SAM_ID.toString());
    expect(execute).not.toHaveBeenCalled();
  });
});
