import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Incident from "../../../../Models/DatabaseModels/Incident";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import User from "../../../../Models/DatabaseModels/User";
import AlertService from "../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../Server/Services/IncidentService";
import UserService from "../../../../Server/Services/UserService";
import RemediationApproval from "../../../../Server/Utils/AutoRemediation/RemediationApproval";
import { getRemediationPlanFingerprint } from "../../../../Server/Utils/AutoRemediation/RemediationPlanFingerprint";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import {
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
} from "../../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * Contract under test - approving and dismissing OneUptime AI's fixes from
 * Slack and Microsoft Teams, in the same way in both
 * (Server/Utils/Workspace/WorkspaceRemediationActions):
 *
 *  - the fix a press names is read in the press's project only;
 *  - who may press: a member who may run fixes (a runbook execution, as
 *    the Dashboard's Approve asks) and read the incident or alert the fix
 *    is for - asked through WorkspaceActionAuthorization, which words the
 *    refusal for the chat;
 *  - a press on a fix that no longer waits says who decided it, and when,
 *    as news - or that OneUptime AI made it on its own;
 *  - the dialog names what the fix is for and everything it runs, and
 *    carries the fix and its fingerprint now;
 *  - Approve and run and Dismiss go through RemediationApproval, as the
 *    member, with the fingerprint and the chat;
 *  - a button value this product never wrote is refused.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const ALERT_ID: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000004");
const USER_ID: ObjectID = new ObjectID("50000000-0000-4000-8000-000000000005");
const APPROVER_ID: ObjectID = new ObjectID(
  "60000000-0000-4000-8000-000000000006",
);
const ECS: string =
  "arn:aws:ecs:us-east-1:123456789012:service/prod/checkout-api";

// A fix's columns to set, an undefined one cleared (exactOptionalPropertyTypes).
type FixOverrides = {
  [Column in keyof AutoRemediationSuggestion]?:
    | AutoRemediationSuggestion[Column]
    | undefined;
};

function fix(overrides: FixOverrides = {}): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row.id = SUGGESTION_ID;
  row._id = SUGGESTION_ID.toString();
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.status = AutoRemediationSuggestionStatus.Suggested;
  row.suggestionType = AutoRemediationSuggestionType.CommandPlan;
  row.commandPlan = AiRemediationCommandPlanUtil.toJSON({
    commands: [
      {
        sequence: 1,
        stepType: RunbookStepType.ResourceCommand,
        runnerId: "70000000-0000-4000-8000-000000000007",
        runnerNameSnapshot: "Cloud AI agent",
        resourceType: AiResourceType.AwsAccount,
        resourceId: "80000000-0000-4000-8000-000000000008",
        resourceNameSnapshot: "prod",
        resourceCommandTier: ResourceCommandTier.SafeWrite,
        command: `cloud scale-out ${ECS} --count 8`,
        rollbackCommand: `cloud scale-in ${ECS} --count 4`,
        timeoutInMs: 60000,
        rationale: "tasks at 100% CPU",
        expectedEffect: "latency drops",
        policyVerdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
      },
    ],
  });
  row.verificationWindowMinutes = 15;
  Object.assign(row, overrides);
  return row;
}

const memberProps: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading the fix a press names", () => {
  test("only in the press's project, as OneUptime", async () => {
    const find: AnySpy = jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockResolvedValue(fix() as never) as AnySpy;

    const read: AutoRemediationSuggestion | null =
      await WorkspaceRemediationActions.readFix({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      });

    expect(read?.id?.toString()).toBe(SUGGESTION_ID.toString());

    const args: JSONObject = find.mock.calls[0]![0] as JSONObject;
    expect(args["query"]).toEqual({
      _id: SUGGESTION_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect((args["props"] as JSONObject)["isRoot"]).toBe(true);
    // What the dialog, the late answer and the fingerprint read.
    for (const column of [
      "status",
      "suggestionType",
      "commandPlan",
      "mcpToolCallPlan",
      "runbookId",
      "approvedByUserId",
      "approvedAt",
      "dismissedByUserId",
      "dismissedAt",
      "verificationWindowMinutes",
    ]) {
      expect((args["select"] as JSONObject)[column]).toBe(true);
    }
  });

  test("a fix that is not there - gone, or another project's - is none", async () => {
    jest
      .spyOn(AutoRemediationSuggestionService, "findOneBy")
      .mockResolvedValue(null as never);

    expect(
      await WorkspaceRemediationActions.readFix({
        suggestionId: SUGGESTION_ID,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });
});

describe("who may press", () => {
  test("a member who may run fixes and read the incident the fix is for", async () => {
    const authorize: AnySpy = jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockResolvedValue(memberProps as never) as AnySpy;

    const props: DatabaseCommonInteractionProps =
      await WorkspaceRemediationActions.authorize({
        userId: USER_ID,
        projectId: PROJECT_ID,
        suggestion: fix(),
        action: WorkspaceRemediationActions.APPROVE_ACTION,
      });

    expect(props).toBe(memberProps);

    const args: JSONObject = authorize.mock.calls[0]![0] as JSONObject;
    expect(args["userId"]).toBe(USER_ID);
    expect(args["projectId"]).toBe(PROJECT_ID);
    expect(args["modelType"]).toBe(RunbookExecution);
    expect(args["action"]).toBe("approve this fix");

    const resources: Array<JSONObject> = args["resources"] as Array<JSONObject>;
    expect(resources).toHaveLength(1);
    expect(resources[0]!["service"]).toBe(IncidentService);
    expect(resources[0]!["id"]).toBe(INCIDENT_ID);
  });

  test("an alert's fix asks to read the alert", async () => {
    const authorize: AnySpy = jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockResolvedValue(memberProps as never) as AnySpy;

    await WorkspaceRemediationActions.authorize({
      userId: USER_ID,
      projectId: PROJECT_ID,
      suggestion: fix({ incidentId: undefined, alertId: ALERT_ID }),
      action: WorkspaceRemediationActions.DISMISS_ACTION,
    });

    const resources: Array<JSONObject> = (
      authorize.mock.calls[0]![0] as JSONObject
    )["resources"] as Array<JSONObject>;

    expect(resources[0]!["service"]).toBe(AlertService);
    expect(resources[0]!["id"]).toBe(ALERT_ID);
    expect((authorize.mock.calls[0]![0] as JSONObject)["action"]).toBe(
      "dismiss this fix",
    );
  });

  test("a refusal is the authorization's own, worded for the chat", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockRejectedValue(
        new Error("You do not have permission to approve this fix.") as never,
      );

    await expect(
      WorkspaceRemediationActions.authorize({
        userId: USER_ID,
        projectId: PROJECT_ID,
        suggestion: fix(),
        action: WorkspaceRemediationActions.APPROVE_ACTION,
      }),
    ).rejects.toThrow("You do not have permission to approve this fix.");
  });
});

describe("a press that came too late", () => {
  function approver(): void {
    const user: User = new User();
    user.name = new Name("Maya Chen");
    jest.spyOn(UserService, "findOneById").mockResolvedValue(user as never);
  }

  test("a fix that still waits answers nothing", async () => {
    expect(
      await WorkspaceRemediationActions.getLatePressAnswer(fix()),
    ).toBeNull();
  });

  test("approved: by whom and when, as news", async () => {
    approver();

    const answer: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getLatePressAnswer(
        fix({
          status: AutoRemediationSuggestionStatus.Approved,
          approvedByUserId: APPROVER_ID,
          approvedAt: new Date("2026-11-01T18:07:00.000Z"),
        }),
      );

    expect(answer?.markdown).toBe(
      "✅ This fix was already approved by **Maya Chen** at {{TIME(2026-11-01T18:07:00Z)}}.",
    );
    expect(answer?.text).toBe("This fix was already approved by Maya Chen");
  });

  test("dismissed: by whom", async () => {
    approver();

    const answer: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getLatePressAnswer(
        fix({
          status: AutoRemediationSuggestionStatus.Dismissed,
          dismissedByUserId: APPROVER_ID,
        }),
      );

    expect(answer?.markdown).toBe(
      "This fix was already dismissed by **Maya Chen**.",
    );
  });

  test("a name that cannot be read is left out, the news kept", async () => {
    jest
      .spyOn(UserService, "findOneById")
      .mockRejectedValue(new Error("db down") as never);

    const answer: WorkspaceAnswer | null =
      await WorkspaceRemediationActions.getLatePressAnswer(
        fix({
          status: AutoRemediationSuggestionStatus.Approved,
          approvedByUserId: APPROVER_ID,
        }),
      );

    expect(answer?.markdown).toBe("✅ This fix was already approved.");
  });

  test("made on its own, or anything else: said plainly", async () => {
    expect(
      (
        await WorkspaceRemediationActions.getLatePressAnswer(
          fix({ status: AutoRemediationSuggestionStatus.AutoExecuted }),
        )
      )?.markdown,
    ).toBe("✅ OneUptime AI already made this fix on its own.");

    for (const status of [
      AutoRemediationSuggestionStatus.Planning,
      AutoRemediationSuggestionStatus.NoneApplicable,
    ]) {
      expect(
        (await WorkspaceRemediationActions.getLatePressAnswer(fix({ status })))
          ?.text,
      ).toBe("This fix no longer waits for approval");
    }
  });
});

describe("the approval dialog", () => {
  test("names what the fix is for and everything it runs, and carries its fingerprint now", async () => {
    const incident: Incident = new Incident();
    incident.incidentNumberWithPrefix = "INC-42";
    incident.title = "Checkout API p95 latency above 2s";
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(incident as never);

    const row: AutoRemediationSuggestion = fix();
    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(row);

    expect(dialog?.title).toBe("Approve this fix?");
    expect(dialog?.submitTitle).toBe("Approve and run");
    expect(dialog?.cancelTitle).toBe("Cancel");
    expect(dialog?.markdown).toContain(
      "**Incident INC-42:** Checkout API p95 latency above 2s",
    );
    expect(dialog?.markdown).toContain(
      "Scale the ECS service checkout-api out to 8 tasks",
    );
    expect(dialog?.markdown).toContain("Approving runs exactly what is shown");
    expect(dialog?.value).toBe(
      `${SUGGESTION_ID.toString()}:${getRemediationPlanFingerprint(row)}`,
    );
  });

  test("an incident without a number is still named", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(new Incident() as never);

    const dialog: RemediationApprovalDialog | null =
      await WorkspaceRemediationActions.getApprovalDialog(fix());

    expect(dialog?.markdown.startsWith("**Incident**")).toBe(true);
  });

  test("a fix with no id has no dialog", async () => {
    expect(
      await WorkspaceRemediationActions.getApprovalDialog(
        new AutoRemediationSuggestion(),
      ),
    ).toBeNull();
  });
});

describe("approving and dismissing", () => {
  test("approve goes through RemediationApproval, as the member, with the fingerprint and the chat", async () => {
    const approve: AnySpy = jest
      .spyOn(RemediationApproval, "approve")
      .mockResolvedValue({} as never) as AnySpy;

    const answer: WorkspaceAnswer = await WorkspaceRemediationActions.approve({
      props: memberProps,
      value: { suggestionId: SUGGESTION_ID, fingerprint: "0123456789abcdef" },
      from: WorkspaceType.MicrosoftTeams,
    });

    expect(approve).toHaveBeenCalledWith({
      props: memberProps,
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: "0123456789abcdef",
      from: WorkspaceType.MicrosoftTeams,
    });
    // What the presser is told: it is being made, and where to follow it.
    expect(answer).toEqual({
      markdown:
        "✅ You approved this fix: OneUptime AI is making it now. Its incident or alert in OneUptime shows how it goes.",
      text: "You approved this fix",
    });
  });

  test("a refused approval is thrown for the chat to tell", async () => {
    jest
      .spyOn(RemediationApproval, "approve")
      .mockRejectedValue(new BadDataException("AI is disabled") as never);

    await expect(
      WorkspaceRemediationActions.approve({
        props: memberProps,
        value: { suggestionId: SUGGESTION_ID, fingerprint: "0123456789abcdef" },
        from: WorkspaceType.Slack,
      }),
    ).rejects.toThrow("AI is disabled");
  });

  test("dismiss goes through RemediationApproval too, and says what it did", async () => {
    const dismiss: AnySpy = jest
      .spyOn(RemediationApproval, "dismiss")
      .mockResolvedValue({} as never) as AnySpy;

    const answer: WorkspaceAnswer = await WorkspaceRemediationActions.dismiss({
      props: memberProps,
      value: { suggestionId: SUGGESTION_ID, fingerprint: "0123456789abcdef" },
      from: WorkspaceType.Slack,
    });

    expect(dismiss).toHaveBeenCalledWith({
      props: memberProps,
      suggestionId: SUGGESTION_ID.toString(),
      expectedPlanFingerprint: "0123456789abcdef",
      from: WorkspaceType.Slack,
    });
    expect(answer.markdown).toBe(
      "You dismissed this fix: OneUptime AI will not run it. Its incident or alert in OneUptime keeps what it proposed.",
    );
  });
});

describe("a button's value", () => {
  test("one this product wrote is read", () => {
    expect(
      WorkspaceRemediationActions.readValue(
        `${SUGGESTION_ID.toString()}:0123456789abcdef`,
      ).fingerprint,
    ).toBe("0123456789abcdef");
  });

  test("anything else is refused before anything is read", () => {
    for (const value of [
      undefined,
      "",
      "INC-42",
      `${SUGGESTION_ID.toString()}`,
    ]) {
      expect(() => {
        return WorkspaceRemediationActions.readValue(value);
      }).toThrow(BadDataException);
    }
  });

  test("a fix that is gone is said so, naming the product", () => {
    expect(WorkspaceRemediationActions.getNotFoundMessage()).toBe(
      "This fix is no longer in OneUptime. It may have been deleted.",
    );
  });
});
