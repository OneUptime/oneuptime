import fs from "fs";
import path from "path";
import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import CommandPlanExecutor from "../../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import RunbookRunAccess from "../../../../Server/Utils/Runbook/RunbookRunAccess";
import McpRemediationRunner from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import ProjectService from "../../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import RunnerService from "../../../../Server/Services/RunnerService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Project from "../../../../Models/DatabaseModels/Project";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { AddFixApprovalSourceAndRunbookTrackRecord1808992660000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808992660000-AddFixApprovalSourceAndRunbookTrackRecord";
import {
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationApprovalSource, {
  getRemediationApprovalSource,
  isRemediationApprovedFromChat,
  readRemediationApprovalSource,
} from "../../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - where a fix was approved is kept on its suggestion
 * (AutoRemediationSuggestion.approvedFrom, #5519's follow-up):
 *
 *  - every approval writes where it was made with the approver and the
 *    time, in the one claim that approves it: the AI card ("Dashboard"),
 *    Slack or Microsoft Teams - for a runbook, an AI command plan and a fix
 *    through MCP servers alike;
 *  - a refused approval writes nothing;
 *  - the column is the server's alone (no create or update), read as the
 *    suggestion's other approval columns are, and only the three places;
 *  - the migration adds it, and the runbook's track record, as the model
 *    declares them, and takes them away again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const USER_ID: ObjectID = new ObjectID("cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03");
const INCIDENT_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04",
);
const SERVER_ID: string = "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05";
const RUNNER_ID: string = "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b06";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "cc1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b07",
);

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

function base(): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    verificationWindowMinutes: 15,
  };
}

const ROWS: Record<string, () => Record<string, unknown>> = {
  "a runbook": (): Record<string, unknown> => {
    return {
      ...base(),
      suggestionType: AutoRemediationSuggestionType.Runbook,
      runbookId: RUNBOOK_ID,
      runbookNameSnapshot: "Restart checkout",
    };
  },
  "an AI command plan": (): Record<string, unknown> => {
    return {
      ...base(),
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      commandPlan: AiRemediationCommandPlanUtil.toJSON({
        commands: [
          {
            sequence: 1,
            stepType: RunbookStepType.Bash,
            runnerId: RUNNER_ID,
            runnerNameSnapshot: "Runner",
            command: "systemctl restart nginx",
            timeoutInMs: 60000,
            rationale: "nginx stopped",
            expectedEffect: "it serves again",
            policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          },
        ],
      }),
    };
  },
  "a fix through MCP servers": (): Record<string, unknown> => {
    return {
      ...base(),
      suggestionType: AutoRemediationSuggestionType.McpToolCalls,
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [
          {
            sequence: 1,
            serverId: SERVER_ID,
            serverNameSnapshot: "Feature flags",
            toolName: "set_flag",
            arguments: { flag: "checkout-v2", enabled: false },
            status: ExternalMcpToolCallStatus.Proposed,
          },
        ],
      }),
    };
  },
};

describe("where a fix was approved is kept with its approval", () => {
  let row: Record<string, unknown>;
  let claims: Array<{ set: Record<string, unknown> }>;

  beforeEach(() => {
    claims = [];

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

    const server: ExternalMcpServer = new ExternalMcpServer();
    server.id = new ObjectID(SERVER_ID);
    server._id = SERVER_ID;
    server.projectId = PROJECT_ID;
    jest
      .spyOn(ExternalMcpServerService, "findServersForRun")
      .mockResolvedValue([server] as never);
    jest
      .spyOn(McpRemediationRunner, "executeApprovedCalls")
      .mockResolvedValue(undefined as never);

    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      id: new ObjectID(RUNNER_ID),
      _id: RUNNER_ID,
      name: "Runner",
    } as unknown as Runner as never);
    jest
      .spyOn(CommandPlanExecutor, "executeApprovedPlan")
      .mockResolvedValue(undefined as never);

    jest.spyOn(RunbookRunAccess, "assertMayStart").mockResolvedValue();
    jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue({ id: ObjectID.generate() } as never);

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Where each kind of fix can be approved: on the card, or from a chat.
  const PLACES: Array<
    [WorkspaceType | undefined, AutoRemediationApprovalSource]
  > = [
    [undefined, AutoRemediationApprovalSource.Dashboard],
    [WorkspaceType.Slack, AutoRemediationApprovalSource.Slack],
    [
      WorkspaceType.MicrosoftTeams,
      AutoRemediationApprovalSource.MicrosoftTeams,
    ],
  ];

  // [the kind of fix, where it was approved, what is kept, the chat it came from]
  type ApprovalCase = [
    string,
    string,
    AutoRemediationApprovalSource,
    WorkspaceType | undefined,
  ];

  const APPROVALS: Array<ApprovalCase> = Object.keys(ROWS).flatMap(
    (kind: string): Array<ApprovalCase> => {
      return PLACES.map(
        ([from, source]: [
          WorkspaceType | undefined,
          AutoRemediationApprovalSource,
        ]): ApprovalCase => {
          return [kind, from ? `from ${from}` : "on the card", source, from];
        },
      );
    },
  );

  test.each(APPROVALS)(
    "%s, approved %s, keeps %s",
    async (
      kind: string,
      _where: string,
      source: AutoRemediationApprovalSource,
      from: WorkspaceType | undefined,
    ) => {
      row = ROWS[kind]!();

      await RemediationApproval.approve({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        ...(from
          ? {
              from,
              expectedPlanFingerprint: getRemediationPlanFingerprint({
                suggestionType: row[
                  "suggestionType"
                ] as AutoRemediationSuggestionType,
                commandPlan: row["commandPlan"] as JSONObject | undefined,
                mcpToolCallPlan: row["mcpToolCallPlan"] as
                  | JSONObject
                  | undefined,
                runbookId: row["runbookId"] as ObjectID | undefined,
              }),
            }
          : {}),
      });

      expect(claims).toHaveLength(1);
      expect(claims[0]!.set["status"]).toBe(
        AutoRemediationSuggestionStatus.Approved,
      );
      expect(claims[0]!.set["approvedFrom"]).toBe(source);
      // With who approved it and when, in the same claim.
      expect(claims[0]!.set["approvedByUserId"]).toBe(USER_ID.toString());
      expect(claims[0]!.set["approvedAt"]).toBeInstanceOf(Date);
    },
  );

  test("a refused approval keeps nothing of where", async () => {
    row = ROWS["a fix through MCP servers"]!();

    await expect(
      RemediationApproval.approve({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: "0000000000000000",
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow();

    expect(claims).toHaveLength(0);
  });

  test("a dismissal says nothing of where a fix was approved", async () => {
    row = ROWS["a runbook"]!();

    await RemediationApproval.dismiss({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(claims[0]!.set["status"]).toBe(
      AutoRemediationSuggestionStatus.Dismissed,
    );
    expect("approvedFrom" in claims[0]!.set).toBe(false);
  });
});

describe("the places a fix is approved", () => {
  test("a chat is its own place, and the card is any other", () => {
    expect(getRemediationApprovalSource(WorkspaceType.Slack)).toBe(
      AutoRemediationApprovalSource.Slack,
    );
    expect(getRemediationApprovalSource(WorkspaceType.MicrosoftTeams)).toBe(
      AutoRemediationApprovalSource.MicrosoftTeams,
    );
    expect(getRemediationApprovalSource(undefined)).toBe(
      AutoRemediationApprovalSource.Dashboard,
    );
    expect(Object.values(AutoRemediationApprovalSource)).toEqual([
      "Dashboard",
      "Slack",
      "MicrosoftTeams",
    ]);
  });

  test("a stored value is read back only when it is one of them", () => {
    expect(readRemediationApprovalSource("Slack")).toBe(
      AutoRemediationApprovalSource.Slack,
    );
    for (const value of ["slack", "Discord", "", null, undefined, 3, {}]) {
      expect(readRemediationApprovalSource(value)).toBeUndefined();
    }
    expect(
      isRemediationApprovedFromChat(AutoRemediationApprovalSource.Slack),
    ).toBe(true);
    expect(
      isRemediationApprovedFromChat(
        AutoRemediationApprovalSource.MicrosoftTeams,
      ),
    ).toBe(true);
    expect(
      isRemediationApprovedFromChat(AutoRemediationApprovalSource.Dashboard),
    ).toBe(false);
    expect(isRemediationApprovedFromChat(undefined)).toBe(false);
  });
});

describe("the columns", () => {
  const model: AutoRemediationSuggestion = new AutoRemediationSuggestion();

  test("approvedFrom is the server's, read as the other approval columns are, one of the three places", () => {
    const column: TableColumnMetadata =
      model.getTableColumnMetadata("approvedFrom");

    expect(column.required).toBe(false);
    expect(column.allowedValues).toEqual(
      Object.values(AutoRemediationApprovalSource),
    );
    expect(column.title).toBe("Approved From");
    expect((column.description || "").length).toBeLessThanOrEqual(150);

    const access: JSONObject = model.getColumnAccessControlFor(
      "approvedFrom",
    ) as unknown as JSONObject;
    const approvedAt: JSONObject = model.getColumnAccessControlFor(
      "approvedAt",
    ) as unknown as JSONObject;

    expect(access["create"]).toEqual([]);
    expect(access["update"]).toEqual([]);
    expect(access["read"]).toEqual(approvedAt["read"]);
  });

  test("runbookTrackRecord is the server's JSON, read as the command plan is", () => {
    const column: TableColumnMetadata =
      model.getTableColumnMetadata("runbookTrackRecord");

    expect(column.required).toBe(false);
    expect((column.description || "").length).toBeLessThanOrEqual(150);

    const access: JSONObject = model.getColumnAccessControlFor(
      "runbookTrackRecord",
    ) as unknown as JSONObject;
    const commandPlan: JSONObject = model.getColumnAccessControlFor(
      "commandPlan",
    ) as unknown as JSONObject;

    expect(access["create"]).toEqual([]);
    expect(access["update"]).toEqual([]);
    expect(access["read"]).toEqual(commandPlan["read"]);
  });
});

describe("the migration", () => {
  test("adds both columns, nullable, as the model declares them, and takes them away", async () => {
    const queries: Array<string> = [];
    const runner: { query: (sql: string) => Promise<void> } = {
      query: async (sql: string): Promise<void> => {
        queries.push(sql);
      },
    };
    const migration: AddFixApprovalSourceAndRunbookTrackRecord1808992660000 =
      new AddFixApprovalSourceAndRunbookTrackRecord1808992660000();

    expect(migration.name).toBe(
      "AddFixApprovalSourceAndRunbookTrackRecord1808992660000",
    );

    await migration.up(runner as never);

    expect(queries).toEqual([
      'ALTER TABLE "AutoRemediationSuggestion" ADD "runbookTrackRecord" jsonb',
      'ALTER TABLE "AutoRemediationSuggestion" ADD "approvedFrom" character varying(100)',
    ]);
    // Nullable, no default: the rows written before keep nothing.
    for (const sql of queries) {
      expect(sql).not.toContain("NOT NULL");
      expect(sql).not.toContain("DEFAULT");
    }

    queries.length = 0;
    await migration.down(runner as never);

    expect(queries).toEqual([
      'ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "approvedFrom"',
      'ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "runbookTrackRecord"',
    ]);
  });

  test("is registered, after every migration before it", () => {
    const index: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
      ),
      "utf8",
    );

    expect(index).toContain(
      'import { AddFixApprovalSourceAndRunbookTrackRecord1808992660000 } from "./1808992660000-AddFixApprovalSourceAndRunbookTrackRecord";',
    );
    expect(index).toContain(
      "  AddFixApprovalSourceAndRunbookTrackRecord1808992660000,\n",
    );
  });
});
