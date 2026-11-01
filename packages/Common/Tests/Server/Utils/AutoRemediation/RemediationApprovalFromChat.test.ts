import RemediationApproval, {
  getFixChangedSinceMessage,
} from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import ProjectService from "../../../../Server/Services/ProjectService";
import McpRemediationRunner from "../../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
 * Contract under test - approving and dismissing a fix from a Slack or
 * Microsoft Teams message (RemediationApproval, with the fingerprint the
 * message carried and where it was pressed):
 *
 *  - a fix that still runs exactly what the message showed is approved
 *    through the same checks as the Dashboard's Approve, and the record's
 *    feed (and so its channels) says it was approved from that chat;
 *  - a fix that changed since its message - another fingerprint, or one
 *    that is not a fingerprint - is neither approved nor dismissed from it:
 *    nothing is claimed, nothing runs, and the person is told to look at it
 *    in OneUptime;
 *  - from a message, only a fix that still waits for approval is
 *    dismissed;
 *  - the Dashboard's Approve and Dismiss (no fingerprint, no chat) are
 *    unchanged.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const USER_ID: ObjectID = new ObjectID("aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03");
const INCIDENT_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04",
);
const SERVER_ID: string = "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05";

function caller(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function call(status: ExternalMcpToolCallStatus): ExternalMcpToolCall {
  return {
    sequence: 1,
    serverId: SERVER_ID,
    serverNameSnapshot: "Feature flags",
    toolName: "set_flag",
    arguments: { flag: "checkout-db-pool-v2", enabled: false },
    status,
  };
}

function mcpRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
      calls: [call(ExternalMcpToolCallStatus.Proposed)],
    }),
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

function commandRow(): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: AiRemediationCommandPlanUtil.toJSON({
      commands: [
        {
          sequence: 1,
          stepType: RunbookStepType.Bash,
          runnerId: "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b06",
          runnerNameSnapshot: "Runner",
          command: "systemctl restart nginx",
          timeoutInMs: 60000,
          rationale: "nginx stopped",
          expectedEffect: "it serves again",
          policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
        },
      ],
    }),
    verificationWindowMinutes: 15,
  };
}

function fingerprintOf(row: Record<string, unknown>): string {
  return getRemediationPlanFingerprint({
    suggestionType: row["suggestionType"] as AutoRemediationSuggestionType,
    commandPlan: row["commandPlan"] as JSONObject | undefined,
    mcpToolCallPlan: row["mcpToolCallPlan"] as JSONObject | undefined,
  });
}

describe("approving or dismissing a fix from a chat message", () => {
  let row: Record<string, unknown>;
  let casSpy: jest.SpyInstance;
  let executeSpy: jest.SpyInstance;
  let feedSpy: jest.SpyInstance;

  beforeEach(() => {
    row = mcpRow();

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

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

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

    executeSpy = jest
      .spyOn(McpRemediationRunner, "executeApprovedCalls")
      .mockResolvedValue(undefined as never);

    feedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a fix that still runs what the message showed is approved, and its feed says from where", async () => {
    await RemediationApproval.approve({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: fingerprintOf(row),
      from: WorkspaceType.Slack,
    });

    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });

    const feed: JSONObject = feedSpy.mock.calls[0]![0] as JSONObject;

    expect(String(feed["feedInfoInMarkdown"])).toContain(
      "⚡ Approved the **fix through MCP servers** from Slack (1 change).",
    );
    expect(feed["userId"]).toBe(USER_ID);
    expect(
      (feed["workspaceNotification"] as JSONObject)["leadWithAuthor"],
    ).toBe(true);
  });

  test("from Microsoft Teams, the feed names Microsoft Teams", async () => {
    await RemediationApproval.approve({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: fingerprintOf(row),
      from: WorkspaceType.MicrosoftTeams,
    });

    expect(
      String((feedSpy.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"]),
    ).toContain("from Microsoft Teams");
  });

  test("a fix that changed since its message is not approved from it", async () => {
    const shown: string = fingerprintOf(row);

    row = mcpRow({
      mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({
        calls: [
          {
            ...call(ExternalMcpToolCallStatus.Proposed),
            arguments: { flag: "checkout-db-pool-v2", enabled: true },
          },
        ],
      }),
    });

    await expect(
      RemediationApproval.approve({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: shown,
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow(getFixChangedSinceMessage());

    expect(casSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a value that is not a fingerprint is refused the same way", async () => {
    for (const fingerprint of ["", "not-a-fingerprint", "0123456789ABCDEF"]) {
      await expect(
        RemediationApproval.approve({
          props: caller(),
          suggestionId: SUGGESTION_ID.toString(),
          expectedPlanFingerprint: fingerprint,
          from: WorkspaceType.Slack,
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    }

    expect(casSpy).not.toHaveBeenCalled();
  });

  test("a command plan that changed since is refused before any of its checks", async () => {
    row = commandRow();

    await expect(
      RemediationApproval.approve({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: "0000000000000000",
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow(getFixChangedSinceMessage());

    expect(casSpy).not.toHaveBeenCalled();
  });

  test("a fix that no longer waits says so, whatever the message showed", async () => {
    row = mcpRow({ status: AutoRemediationSuggestionStatus.Approved });

    await expect(
      RemediationApproval.approve({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: fingerprintOf(mcpRow()),
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow("Only suggested remediations can be approved");
  });

  test("the checks of the Dashboard's Approve still hold: a Viewer may not approve from chat", async () => {
    await expect(
      RemediationApproval.approve({
        props: caller([Permission.Viewer]),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: fingerprintOf(row),
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow();

    expect(casSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("the Dashboard's Approve, with no fingerprint, is unchanged and names no chat", async () => {
    await RemediationApproval.approve({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(
      String((feedSpy.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"]),
    ).toBe(
      "⚡ Approved the **fix through MCP servers** (1 change). The changes are being made; verification will watch the monitors for recovery.",
    );
  });

  test("dismissing from a message: the fix it showed, said from where", async () => {
    const result: JSONObject = await RemediationApproval.dismiss({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: fingerprintOf(row),
      from: WorkspaceType.Slack,
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
    expect(
      String((feedSpy.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"]),
    ).toBe(
      "⚡ Dismissed the **auto-remediation suggestion** from Slack: the fix through MCP servers will not be made.",
    );
  });

  test("a fix that changed, or no longer waits, is not dismissed from a message", async () => {
    await expect(
      RemediationApproval.dismiss({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: "0000000000000000",
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow(getFixChangedSinceMessage());

    row = mcpRow({ status: AutoRemediationSuggestionStatus.Planning });

    await expect(
      RemediationApproval.dismiss({
        props: caller(),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: fingerprintOf(row),
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow(
      "Only suggested or planning remediations can be dismissed",
    );

    expect(casSpy).not.toHaveBeenCalled();
  });

  test("the Dashboard's Dismiss still dismisses a fix being worked out", async () => {
    row = mcpRow({ status: AutoRemediationSuggestionStatus.Planning });
    casSpy.mockResolvedValueOnce(0 as never).mockResolvedValueOnce(1 as never);

    const result: JSONObject = await RemediationApproval.dismiss({
      props: caller(),
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
    expect(casSpy).toHaveBeenCalledTimes(2);
  });

  test("the message the person is shown names the product as the installation does", () => {
    expect(getFixChangedSinceMessage()).toBe(
      "This fix changed after the message you pressed was posted, so nothing was done. Open it in OneUptime to see what it runs now.",
    );
  });
});
