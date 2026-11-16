import RemediationApproval, {
  APPROVE_FIX_ACTION,
  DISMISS_FIX_ACTION,
  DRY_RUN_FIX_ACTION,
} from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import WorkspaceRemediationActions from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import RemediationChatMessage from "../../../../Server/Utils/AutoRemediation/RemediationChatMessage";
import PrivateRecordPermission from "../../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import RunbookRunAccess from "../../../../Server/Utils/Runbook/RunbookRunAccess";
import CallerPlan from "../../../../Server/Utils/Billing/CallerPlan";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A FIX FOR A PRIVATE INCIDENT OR ALERT IS ACTED ON ONLY THROUGH ITS OWNERS
 * (#8913).
 *
 * Approving a fix OneUptime AI proposed, dry-running it again and dismissing
 * it each take the permission to start runbook executions. On a fix for a
 * private incident or alert that permission counts only through the teams
 * that own the record, as a person named its owner, or as a Project Owner or
 * Admin - as every change of a private record does. The maintainer's case:
 * a member of Team 1 (Project Member: may run fixes) and of Team 2 (Viewer),
 * which alone owns a private incident, sees its fix through Team 2 and may
 * run fixes through Team 1 - and is refused, saying why, with nothing run,
 * claimed or posted. The same press from Slack or Microsoft Teams goes
 * through the same check, and the chats ask it before a dialog opens.
 *
 * The rule is the server's own (PrivateRecordWriteCheck over
 * PrivateRecordPermission): only the read that finds which private records
 * the person's permission does not reach is stubbed here - the Postgres
 * suite (PrivateRecordActionsPostgres) runs that read on a migrated database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000001",
);
const USER_ID: ObjectID = new ObjectID("c4c4c4c4-0000-4c4c-8c4c-000000000002");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000003",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000004",
);
const ALERT_ID: ObjectID = new ObjectID("c4c4c4c4-0000-4c4c-8c4c-000000000005");
const RUNBOOK_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000006",
);
const TEAM_1_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000011",
);
const TEAM_2_ID: ObjectID = new ObjectID(
  "c4c4c4c4-0000-4c4c-8c4c-000000000012",
);

function memberWith(
  rows: Array<{ permission: Permission; teamId: ObjectID }>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTeamIds: [TEAM_1_ID, TEAM_2_ID],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows.map(
          (row: { permission: Permission; teamId: ObjectID }) => {
            return {
              _type: "UserPermission",
              permission: row.permission,
              teamId: row.teamId,
              labelIds: [],
              isBlockPermission: false,
            } as UserPermission;
          },
        ),
      },
    },
  };
}

// The maintainer's case: Team 1 may run fixes, Team 2 (the owner) only views.
const member: DatabaseCommonInteractionProps = memberWith([
  { permission: Permission.ProjectMember, teamId: TEAM_1_ID },
  { permission: Permission.Viewer, teamId: TEAM_2_ID },
]);

const projectAdmin: DatabaseCommonInteractionProps = memberWith([
  { permission: Permission.ProjectAdmin, teamId: TEAM_1_ID },
]);

function fixRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    version: 1,
    suggestionType: AutoRemediationSuggestionType.Runbook,
    runbookId: RUNBOOK_ID,
    runbookNameSnapshot: "Restart checkout",
    verificationWindowMinutes: 15,
    ...overrides,
  };
}

const PRIVATE_INCIDENT_REASON: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this. Ask a Project Admin to give one of the teams that own it this permission, or to add you as an owner.";

describe("a fix for a private record, pressed by a member whose owning team may only view it", () => {
  let row: Record<string, unknown>;
  let casSpy: jest.SpyInstance;
  let startSpy: jest.SpyInstance;
  let feedSpy: jest.SpyInstance;
  let unreachableIncident: jest.SpyInstance;
  let unreachableAlert: jest.SpyInstance;
  let unreachableQuery: jest.SpyInstance;

  beforeEach(() => {
    row = fixRow();

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
      .spyOn(AutoRemediationSuggestionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    jest.spyOn(RunbookRunAccess, "assertMayStart").mockResolvedValue();

    const execution: RunbookExecution = new RunbookExecution(
      ObjectID.generate(),
    );
    startSpy = jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue(execution as never);

    feedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    // The fix's chat messages, edited in place after a press: not here.
    jest
      .spyOn(RemediationChatMessage, "refreshKeptMessages")
      .mockResolvedValue(undefined as never);

    /*
     * The read, as OneUptime, of which private records the person's
     * permission does not reach: the incident (or alert) by default.
     */
    unreachableIncident = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(new Incident(INCIDENT_ID) as never);
    unreachableAlert = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(new Alert(ALERT_ID) as never);

    unreachableQuery = jest.spyOn(
      PrivateRecordPermission,
      "getUnreachableRecordsQuery",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Approve is refused, saying why, and nothing is claimed, run or posted", async () => {
    const refusal: unknown = await RemediationApproval.approve({
      props: member,
      suggestionId: SUGGESTION_ID.toString(),
    }).catch((error: unknown) => {
      return error;
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect((refusal as Error).message).toBe(
      `You do not have permission to ${APPROVE_FIX_ACTION}. ${PRIVATE_INCIDENT_REASON}`,
    );

    expect(casSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("the reach asked is the person's permission to start runbook executions, on the incident", async () => {
    await RemediationApproval.approve({
      props: member,
      suggestionId: SUGGESTION_ID.toString(),
    }).catch(() => {
      return undefined;
    });

    expect(unreachableQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: RunbookExecution,
        recordModelType: Incident,
        recordIds: [INCIDENT_ID.toString()],
        type: DatabaseRequestType.Create,
        props: member,
      }),
    );
  });

  test("Dismiss is refused the same way, and the fix stays", async () => {
    await expect(
      RemediationApproval.dismiss({
        props: member,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(
      `You do not have permission to ${DISMISS_FIX_ACTION}. ${PRIVATE_INCIDENT_REASON}`,
    );

    expect(casSpy).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("Dry run again is refused the same way, before anything is checked with the cloud", async () => {
    row = fixRow({
      suggestionType: AutoRemediationSuggestionType.CommandPlan,
      runbookId: undefined,
      commandPlan: { commands: [] },
    });

    await expect(
      RemediationApproval.startDryRun({
        props: member,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(
      `You do not have permission to ${DRY_RUN_FIX_ACTION}. ${PRIVATE_INCIDENT_REASON}`,
    );
  });

  test("a fix for a private alert is refused naming the alert", async () => {
    row = fixRow({ incidentId: undefined, alertId: ALERT_ID });

    await expect(
      RemediationApproval.approve({
        props: member,
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow(
      "You do not have permission to approve this fix. This alert is private,",
    );

    expect(unreachableAlert).toHaveBeenCalledTimes(1);
    expect(unreachableIncident).not.toHaveBeenCalled();
    expect(casSpy).not.toHaveBeenCalled();
  });

  test("a press from Slack or Microsoft Teams is refused the same way", async () => {
    for (const from of [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]) {
      await expect(
        WorkspaceRemediationActions.approve({
          props: member,
          value: { suggestionId: SUGGESTION_ID },
          from: from,
        }),
      ).rejects.toThrow(PRIVATE_INCIDENT_REASON);

      await expect(
        WorkspaceRemediationActions.dismiss({
          props: member,
          value: { suggestionId: SUGGESTION_ID },
          from: from,
        }),
      ).rejects.toThrow(PRIVATE_INCIDENT_REASON);
    }

    expect(casSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  test("someone who may not run fixes at all is told that first", async () => {
    await expect(
      RemediationApproval.approve({
        props: memberWith([
          { permission: Permission.Viewer, teamId: TEAM_2_ID },
        ]),
        suggestionId: SUGGESTION_ID.toString(),
      }),
    ).rejects.toThrow("You do not have permission to start runbook executions");

    expect(unreachableQuery).not.toHaveBeenCalled();
  });

  // POSITIVE: the owners still have full use of the fix.
  test("once a team that owns it may run fixes, Approve starts the runbook, as the person", async () => {
    // Nothing the person's permission does not reach.
    unreachableIncident.mockResolvedValue(null as never);

    const result: JSONObject = await RemediationApproval.approve({
      props: member,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: RUNBOOK_ID,
        linkage: { incidentId: INCIDENT_ID },
        triggeredByUserId: USER_ID,
      }),
    );
  });

  test("so does Dismiss", async () => {
    unreachableIncident.mockResolvedValue(null as never);

    const result: JSONObject = await RemediationApproval.dismiss({
      props: member,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
  });

  test("a Project Admin acts on every private record's fix, and nothing is asked about it", async () => {
    const result: JSONObject = await RemediationApproval.approve({
      props: projectAdmin,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Approved);
    expect(unreachableIncident).not.toHaveBeenCalled();
  });

  test("a fix for no incident or alert is not asked about", async () => {
    row = fixRow({ incidentId: undefined, alertId: undefined });

    const result: JSONObject = await RemediationApproval.dismiss({
      props: member,
      suggestionId: SUGGESTION_ID.toString(),
    });

    expect(result["status"]).toBe(AutoRemediationSuggestionStatus.Dismissed);
    expect(unreachableIncident).not.toHaveBeenCalled();
    expect(unreachableAlert).not.toHaveBeenCalled();
  });
});

describe("the chats ask it before a fix's dialog opens", () => {
  beforeEach(() => {
    jest.spyOn(CallerPlan, "withPlanFor").mockImplementation((async (data: {
      props: DatabaseCommonInteractionProps;
    }): Promise<DatabaseCommonInteractionProps> => {
      return data.props;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function suggestionFor(
    subject: "incident" | "alert",
  ): AutoRemediationSuggestion {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();

    if (subject === "incident") {
      suggestion.incidentId = INCIDENT_ID;
    } else {
      suggestion.alertId = ALERT_ID;
    }

    return suggestion;
  }

  test("a member whose owning team may only view the incident is told why, in the chat's words", async () => {
    const findIncident: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneBy")
      // The member's read of it: they see it, through Team 2.
      .mockResolvedValueOnce({
        _id: INCIDENT_ID.toString(),
        isPrivate: true,
      } as never)
      // The read of what their permission to run fixes does not reach.
      .mockResolvedValueOnce(new Incident(INCIDENT_ID) as never);

    await expect(
      WorkspaceActionAuthorization.assertCanCreateAndRead({
        props: member,
        action: WorkspaceRemediationActions.APPROVE_ACTION,
        ...WorkspaceRemediationActions.getAuthorizationScope(
          suggestionFor("incident"),
        ),
      }),
    ).rejects.toThrow(
      "You do not have permission to approve this fix: this incident is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this.",
    );

    expect(findIncident).toHaveBeenCalledTimes(2);
  });

  test("a public incident's fix is let through without asking its owners", async () => {
    const findIncident: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValueOnce({
        _id: INCIDENT_ID.toString(),
        isPrivate: false,
      } as never);

    await WorkspaceActionAuthorization.assertCanCreateAndRead({
      props: member,
      action: WorkspaceRemediationActions.APPROVE_ACTION,
      ...WorkspaceRemediationActions.getAuthorizationScope(
        suggestionFor("incident"),
      ),
    });

    // Its read, and nothing more.
    expect(findIncident).toHaveBeenCalledTimes(1);
  });

  test("a private alert's owners' team that may run fixes lets the member through", async () => {
    jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValueOnce({
        _id: ALERT_ID.toString(),
        isPrivate: true,
      } as never)
      // Nothing it does not reach.
      .mockResolvedValueOnce(null as never);

    await expect(
      WorkspaceActionAuthorization.assertCanCreateAndRead({
        props: member,
        action: WorkspaceRemediationActions.DISMISS_ACTION,
        ...WorkspaceRemediationActions.getAuthorizationScope(
          suggestionFor("alert"),
        ),
      }),
    ).resolves.toHaveLength(1);
  });
});
