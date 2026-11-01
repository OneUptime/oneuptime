import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { SlackRequest } from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackConnectPrompt from "../../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import SlackRemediationActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Remediation";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceRemediationActions from "../../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import RunbookExecution from "../../../../../Models/DatabaseModels/RunbookExecution";
import { WorkspaceConnectRequestAgainKind } from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceModalBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * Contract under test - a fix OneUptime AI proposes, approved or dismissed
 * in Slack (Server/Utils/Workspace/Slack/Actions/Remediation):
 *
 *  - Slack is answered at once, then the press is acted on;
 *  - Review and approve opens the approval modal for a member who may
 *    approve: its words, Approve and run as its submit, and the fix's
 *    fingerprint now as its value - nothing runs yet;
 *  - Approve and run approves as the member, with the fingerprint the
 *    modal carried and Slack named; a refusal is told where they pressed,
 *    and nothing is logged;
 *  - Dismiss dismisses and says so, only to the presser;
 *  - a member who may not, a fix that is gone, a press that came too late
 *    or a value this app never wrote are each answered where they pressed,
 *    and nothing is approved or dismissed;
 *  - a Slack account that is not connected is asked to connect it to
 *    approve or dismiss, and to press the button again after.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000004",
);
const FINGERPRINT: string = "0123456789abcdef";
const VALUE: string = `${SUGGESTION_ID.toString()}:${FINGERPRINT}`;

const memberProps: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

function suggestion(): AutoRemediationSuggestion {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row.id = SUGGESTION_ID;
  row.projectId = PROJECT_ID;
  row.incidentId = INCIDENT_ID;
  row.status = AutoRemediationSuggestionStatus.Suggested;
  return row;
}

function press(
  actionType: SlackActionType,
  actionValue: string = VALUE,
): {
  slackRequest: SlackRequest;
  action: { actionType: SlackActionType; actionValue: string };
  req: ExpressRequest;
  res: ExpressResponse;
} {
  return {
    slackRequest: {
      isAuthorized: true,
      userId: USER_ID,
      projectId: PROJECT_ID,
      projectAuthToken: "xoxb-project-token",
      botUserId: "B0BOT",
      slackUserId: "U0MEMBER",
      slackUsername: "member",
      slackChannelId: "C0CHANNEL",
      triggerId: "trigger-1",
    },
    action: { actionType, actionValue },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  };
}

let ephemeral: AnySpy;
let showModal: AnySpy;
let readFix: AnySpy;
let authorize: AnySpy;
let approve: AnySpy;
let dismiss: AnySpy;
let logPress: AnySpy;
let respond: AnySpy;

// What the presser was told, only to them, where they pressed.
function answers(): Array<string> {
  return ephemeral.mock.calls.map((call: Array<any>): string => {
    return (call[0] as { messageBlocks: Array<WorkspacePayloadMarkdown> })
      .messageBlocks[0]!.text;
  });
}

beforeEach(() => {
  respond = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation(() => {}) as AnySpy;
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  ephemeral = jest
    .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
    .mockResolvedValue() as AnySpy;
  jest.spyOn(SlackUtil, "sendDirectMessageToUser").mockResolvedValue();
  showModal = jest
    .spyOn(SlackUtil, "showModalToUser")
    .mockResolvedValue() as AnySpy;
  logPress = jest
    .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
    .mockResolvedValue(undefined as never) as AnySpy;
  readFix = jest
    .spyOn(WorkspaceRemediationActions, "readFix")
    .mockResolvedValue(suggestion() as never) as AnySpy;
  authorize = jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockResolvedValue(memberProps as never) as AnySpy;
  jest
    .spyOn(WorkspaceRemediationActions, "getLatePressAnswer")
    .mockResolvedValue(null as never);
  jest
    .spyOn(WorkspaceRemediationActions, "getApprovalDialog")
    .mockResolvedValue({
      title: "Approve this fix?",
      markdown: "**Incident INC-42:** Checkout slow\n\n**1. Scale out**",
      submitTitle: "Approve and run",
      cancelTitle: "Cancel",
      value: `${SUGGESTION_ID.toString()}:fedcba9876543210`,
    } as never);
  approve = jest
    .spyOn(WorkspaceRemediationActions, "approve")
    .mockResolvedValue(undefined as never) as AnySpy;
  dismiss = jest
    .spyOn(WorkspaceRemediationActions, "dismiss")
    .mockResolvedValue({
      markdown: "You dismissed this fix.",
      text: "You dismissed this fix",
    } as never) as AnySpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which presses are a fix's", () => {
  test("Review and approve, Approve and run and Dismiss, nothing else", () => {
    for (const actionType of [
      SlackActionType.ViewApproveRemediation,
      SlackActionType.SubmitApproveRemediation,
      SlackActionType.DismissRemediation,
    ]) {
      expect(SlackRemediationActions.isRemediationAction({ actionType })).toBe(
        true,
      );
    }

    for (const actionType of [
      SlackActionType.AcknowledgeIncident,
      SlackActionType.OpenInOneUptime,
      "Nonsense",
    ]) {
      expect(SlackRemediationActions.isRemediationAction({ actionType })).toBe(
        false,
      );
    }
  });
});

describe("Review and approve", () => {
  test("Slack is answered at once; the modal opens with the fix and Approve and run", async () => {
    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.ViewApproveRemediation),
    );

    expect(respond).toHaveBeenCalledWith({}, {}, { response_action: "clear" });
    expect(readFix).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      projectId: PROJECT_ID,
    });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        projectId: PROJECT_ID,
        action: "approve this fix",
        modelType: RunbookExecution,
      }),
    );
    expect(showModal).toHaveBeenCalledTimes(1);

    const modal: WorkspaceModalBlock = (
      showModal.mock.calls[0]![0] as {
        modalBlock: WorkspaceModalBlock;
      }
    ).modalBlock;

    expect(modal.title).toBe("Approve this fix?");
    expect(modal.submitButtonTitle).toBe("Approve and run");
    expect(modal.cancelButtonTitle).toBe("Cancel");
    expect(modal.actionId).toBe(SlackActionType.SubmitApproveRemediation);
    // The fingerprint of the fix as it is now, with where it was opened.
    expect(modal.actionValue).toContain(
      `${SUGGESTION_ID.toString()}:fedcba9876543210`,
    );
    expect((modal.blocks[0] as WorkspacePayloadMarkdown).text).toContain(
      "**Incident INC-42:** Checkout slow",
    );
    // Nothing runs until Approve and run.
    expect(approve).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  test("a member who may not approve is told so where they pressed, and no modal opens", async () => {
    authorize.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to approve this fix.",
      ) as never,
    );

    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.ViewApproveRemediation),
    );

    expect(showModal).not.toHaveBeenCalled();
    // Refused in the chat's own words, as every other button is.
    expect(answers()).toEqual([
      "You do not have permission to approve this fix.",
    ]);
  });

  test("a fix that is gone is said so", async () => {
    readFix.mockResolvedValue(null as never);

    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.ViewApproveRemediation),
    );

    expect(showModal).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(answers()).toEqual([
      "This fix is no longer in OneUptime. It may have been deleted.",
    ]);
  });

  test("a press that came too late says who got there first, and opens nothing", async () => {
    jest
      .spyOn(WorkspaceRemediationActions, "getLatePressAnswer")
      .mockResolvedValue({
        markdown: "✅ This fix was already approved by **Maya Chen**.",
        text: "This fix was already approved by Maya Chen",
      } as never);

    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.ViewApproveRemediation),
    );

    expect(showModal).not.toHaveBeenCalled();
    expect(answers()).toEqual([
      "✅ This fix was already approved by **Maya Chen**.",
    ]);
  });

  test("a value this app never wrote reads nothing and is refused", async () => {
    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.ViewApproveRemediation, "INC-42"),
    );

    expect(readFix).not.toHaveBeenCalled();
    expect(showModal).not.toHaveBeenCalled();
    expect(answers()[0]).toContain("Could not approve this fix:");
  });
});

describe("Approve and run", () => {
  test("approves as the member, with the fingerprint the modal carried, from Slack, and logs the press", async () => {
    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.SubmitApproveRemediation),
    );

    expect(approve).toHaveBeenCalledTimes(1);
    const args: JSONObject = approve.mock.calls[0]![0] as JSONObject;
    expect(args["props"]).toBe(memberProps);
    expect((args["value"] as JSONObject)["fingerprint"]).toBe(FINGERPRINT);
    expect(
      ((args["value"] as JSONObject)["suggestionId"] as ObjectID).toString(),
    ).toBe(SUGGESTION_ID.toString());
    expect(args["from"]).toBe(WorkspaceType.Slack);

    // The record's feed says who approved it, in the channel: no answer of its own.
    expect(answers()).toEqual([]);
    expect(logPress).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        userId: USER_ID,
        workspaceType: WorkspaceType.Slack,
        buttonAction: "approve_remediation",
        incidentId: INCIDENT_ID,
        channelId: "C0CHANNEL",
      }),
      { isRoot: true },
    );
  });

  test("a refused approval is told where they pressed, and not logged", async () => {
    approve.mockRejectedValue(
      new BadDataException(
        "This fix changed after the message you pressed was posted, so nothing was done.",
      ) as never,
    );

    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.SubmitApproveRemediation),
    );

    expect(answers()).toEqual([
      "Could not approve the fix: This fix changed after the message you pressed was posted, so nothing was done.",
    ]);
    expect(logPress).not.toHaveBeenCalled();
  });
});

describe("Dismiss", () => {
  test("dismisses as the member and tells only them", async () => {
    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.DismissRemediation),
    );

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dismiss this fix" }),
    );
    expect(dismiss).toHaveBeenCalledWith(
      expect.objectContaining({
        props: memberProps,
        from: WorkspaceType.Slack,
      }),
    );
    expect(answers()).toEqual(["You dismissed this fix."]);
    expect(logPress).toHaveBeenCalledWith(
      expect.objectContaining({ buttonAction: "dismiss_remediation" }),
      { isRoot: true },
    );
    expect(approve).not.toHaveBeenCalled();
  });

  test("a refused dismissal is told, nothing logged", async () => {
    dismiss.mockRejectedValue(
      new BadDataException(
        "Only suggested or planning remediations can be dismissed — this one is Approved.",
      ) as never,
    );

    await SlackRemediationActions.handleRemediationAction(
      press(SlackActionType.DismissRemediation),
    );

    expect(answers()).toEqual([
      "Could not dismiss the fix: Only suggested or planning remediations can be dismissed — this one is Approved.",
    ]);
    expect(logPress).not.toHaveBeenCalled();
  });
});

describe("a Slack account that is not connected", () => {
  test("is asked to connect it to approve or dismiss, and to press the button again", () => {
    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.ViewApproveRemediation,
        actionValue: VALUE,
      }),
    ).toEqual({
      purpose: "approve this fix",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Review and approve",
      },
    });
    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.DismissRemediation,
        actionValue: VALUE,
      }),
    ).toEqual({
      purpose: "dismiss this fix",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Dismiss",
      },
    });
  });

  test("never has a fix approved for them once they connect", () => {
    for (const actionType of [
      SlackActionType.ViewApproveRemediation,
      SlackActionType.SubmitApproveRemediation,
      SlackActionType.DismissRemediation,
    ]) {
      expect(
        SlackConnectPrompt.describe({ actionType, actionValue: VALUE })
          .pendingAction,
      ).toBeUndefined();
    }
  });
});
