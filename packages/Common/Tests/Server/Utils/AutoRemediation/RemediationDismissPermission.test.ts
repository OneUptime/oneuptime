import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import WorkspaceRemediationActions from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import {
  RUNBOOK_EXECUTE_PERMISSIONS,
  assertCanDismissFixes,
} from "../../../../Server/Utils/Runbook/RunbookExecutePermission";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import {
  FIX_DISMISS_REFUSED_MESSAGE,
  RUNBOOK_RUN_PERMISSIONS,
} from "../../../../Types/Runbook/RunbookRunPermissions";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Contract under test - who may dismiss a fix OneUptime AI proposed
 * (#5519's follow-up). The fix's Dismiss in Slack and Microsoft Teams asks
 * the member to be someone who may run fixes - create a runbook execution,
 * what the card's Approve asks - while the card's own Dismiss fix asked
 * only to read the fix:
 *
 *  - RemediationApproval.dismiss refuses anyone who may not start runbook
 *    executions in the project, in words of its own, before anything about
 *    the fix is changed, claimed or posted - from the card and from a
 *    message alike;
 *  - everyone who may start them may dismiss, and a team's block on the
 *    permission takes it away, as it takes approving away;
 *  - what it asks is exactly what approving asks, and what the chats'
 *    authorization asks (RunbookExecution's create list).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const USER_ID: ObjectID = new ObjectID("bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03");
const INCIDENT_ID: ObjectID = new ObjectID(
  "bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05",
);

function caller(
  rows: Array<Partial<UserPermission> & { permission: Permission }>,
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows.map(
      (row: Partial<UserPermission> & { permission: Permission }) => {
        return {
          _type: "UserPermission",
          labelIds: [],
          ...row,
        } as UserPermission;
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function holding(...permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return caller(
    permissions.map((permission: Permission) => {
      return { permission };
    }),
  );
}

function runbookRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookId: RUNBOOK_ID,
    runbookNameSnapshot: "Restart checkout",
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

describe("who may dismiss a fix", () => {
  let row: Record<string, unknown>;
  let casSpy: jest.SpyInstance;
  let feedSpy: jest.SpyInstance;

  beforeEach(() => {
    row = runbookRow();

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

  test("the card's Dismiss fix refuses a Viewer, in its own words, and changes nothing", async () => {
    await expect(
      RemediationApproval.dismiss({
        props: holding(Permission.Viewer),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(FIX_DISMISS_REFUSED_MESSAGE);

    await expect(
      RemediationApproval.dismiss({
        props: holding(Permission.Viewer),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(casSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("so does a press on the fix's message, whatever fingerprint it carries", async () => {
    await expect(
      RemediationApproval.dismiss({
        props: holding(Permission.Viewer),
        suggestionId: SUGGESTION_ID.toString(),
        expectedPlanFingerprint: getRemediationPlanFingerprint({
          suggestionType: AutoRemediationSuggestionType.Runbook,
          runbookId: RUNBOOK_ID,
        }),
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow(FIX_DISMISS_REFUSED_MESSAGE);

    expect(casSpy).not.toHaveBeenCalled();
  });

  test("a fix still being worked out is not dismissed by someone who may not run fixes either", async () => {
    row = runbookRow({ status: AutoRemediationSuggestionStatus.Planning });

    await expect(
      RemediationApproval.dismiss({
        props: holding(Permission.Viewer),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(FIX_DISMISS_REFUSED_MESSAGE);

    expect(casSpy).not.toHaveBeenCalled();
  });

  test("the refusal comes before anything about the fix: a decided fix is not described to them", async () => {
    row = runbookRow({ status: AutoRemediationSuggestionStatus.Approved });

    await expect(
      RemediationApproval.dismiss({
        props: holding(Permission.Viewer),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(FIX_DISMISS_REFUSED_MESSAGE);
  });

  test.each(RUNBOOK_RUN_PERMISSIONS.map((permission: Permission) => {
    return [permission];
  }))("%s may dismiss it", async (permission: Permission) => {
    const result: JSONObject = await RemediationApproval.dismiss({
      props: holding(permission),
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
    expect(casSpy).toHaveBeenCalledTimes(1);

    const claimed: JSONObject = casSpy.mock.calls[0]![0] as JSONObject;

    expect((claimed["set"] as JSONObject)["dismissedByUserId"]).toBe(
      USER_ID.toString(),
    );
    expect(String((feedSpy.mock.calls[0]![0] as JSONObject)["feedInfoInMarkdown"])).toBe(
      '⚡ Dismissed the **auto-remediation suggestion**: runbook "Restart checkout" will not be run.',
    );
  });

  test("a team's block on the permission takes dismissing away, as it takes approving away", async () => {
    const blocked: DatabaseCommonInteractionProps = caller([
      { permission: Permission.ProjectMember },
      { permission: Permission.ProjectMember, isBlockPermission: true },
    ]);

    await expect(
      RemediationApproval.dismiss({
        props: blocked,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(FIX_DISMISS_REFUSED_MESSAGE);

    await expect(
      RemediationApproval.approve({
        props: blocked,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(casSpy).not.toHaveBeenCalled();
  });
});

describe("what dismissing asks is what approving and the chats ask", () => {
  test("the run list, as approving asks it", () => {
    expect(RUNBOOK_EXECUTE_PERMISSIONS).toEqual([...RUNBOOK_RUN_PERMISSIONS]);

    expect(() => {
      assertCanDismissFixes(holding(Permission.RunbookMember), PROJECT_ID);
    }).not.toThrow();
    expect(() => {
      assertCanDismissFixes(holding(Permission.RunbookViewer), PROJECT_ID);
    }).toThrow(FIX_DISMISS_REFUSED_MESSAGE);
    // Another project's grant is none here.
    expect(() => {
      assertCanDismissFixes(
        holding(Permission.ProjectMember),
        new ObjectID("bb1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8bff"),
      );
    }).toThrow(FIX_DISMISS_REFUSED_MESSAGE);
  });

  test("the chats authorize a press on creating a runbook execution, whose create list is the same", () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();
    suggestion.incidentId = INCIDENT_ID;

    expect(
      WorkspaceRemediationActions.getAuthorizationScope(suggestion).modelType,
    ).toBe(RunbookExecution);
    expect(new RunbookExecution().getCreatePermissions().sort()).toEqual(
      [...RUNBOOK_RUN_PERMISSIONS].sort(),
    );
  });

  test("the refusal says what dismissing needs, in words a person reads", () => {
    expect(FIX_DISMISS_REFUSED_MESSAGE).toBe(
      "You do not have permission to dismiss this fix. Dismissing a fix needs the permission approving one does: starting runbook executions in this project.",
    );
  });
});
