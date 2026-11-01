import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import type { TurnContext } from "botbuilder";
import AutoRemediationSuggestion from "../../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  getMicrosoftTeamsActionType,
  MicrosoftTeamsRemediationActionType,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsRemediationActions from "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Remediation";
import MicrosoftTeamsConnectPrompt from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { WorkspaceConnectRequestAgainKind } from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceRemediationActions, {
  RemediationApprovalDialog,
} from "../../../../../Server/Utils/Workspace/WorkspaceRemediationActions";
import AutoRemediationSuggestionStatus from "../../../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * Contract under test - a fix OneUptime AI proposes, approved or dismissed
 * in Microsoft Teams (Server/Utils/Workspace/MicrosoftTeams/Actions/
 * Remediation):
 *
 *  - the fix card's buttons carry Slack's ids, which are the Teams ids;
 *  - Review and approve answers with an approval card: the dialog's title
 *    and Markdown, and Approve and run (positive) carrying the fix and its
 *    fingerprint now - nothing runs yet;
 *  - Approve and run approves as the member with that fingerprint, from
 *    Microsoft Teams, and removes the approval card;
 *  - Dismiss dismisses and answers the presser;
 *  - a refusal - who may not, a fix that changed - is thrown for the bot's
 *    own catch, which answers every press's refusal; a fix that is gone or
 *    a press that came too late is answered here;
 *  - an account that is not connected is asked to connect it, and to press
 *    the button again.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const SUGGESTION_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const FINGERPRINT: string = "0123456789abcdef";
const VALUE: string = `${SUGGESTION_ID.toString()}:${FINGERPRINT}`;

const memberProps: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

interface FakeTurn {
  turnContext: TurnContext;
  replies: Array<unknown>;
  deleted: Array<unknown>;
}

function createTurn(): FakeTurn {
  const replies: Array<unknown> = [];
  const deleted: Array<unknown> = [];

  return {
    replies,
    deleted,
    turnContext: {
      activity: {
        replyToId: "approval-card-activity",
        from: { id: "29:member", name: "Maya Chen" },
      },
      deleteActivity: jest.fn(async (id: unknown): Promise<void> => {
        deleted.push(id);
      }),
      sendActivity: jest.fn(async (reply: unknown): Promise<void> => {
        replies.push(reply);
      }),
    } as unknown as TurnContext,
  };
}

function card(reply: unknown): JSONObject {
  return (reply as { attachments: Array<JSONObject> }).attachments[0]![
    "content"
  ] as JSONObject;
}

function replyText(reply: unknown): string {
  const body: Array<JSONObject> = card(reply)["body"] as Array<JSONObject>;

  return body
    .map((element: JSONObject): string => {
      return String(element["text"] || "");
    })
    .join("\n");
}

let readFix: AnySpy;
let approve: AnySpy;
let dismiss: AnySpy;

beforeEach(() => {
  const row: AutoRemediationSuggestion = new AutoRemediationSuggestion();
  row.id = SUGGESTION_ID;
  row.projectId = PROJECT_ID;
  row.status = AutoRemediationSuggestionStatus.Suggested;

  readFix = jest
    .spyOn(WorkspaceRemediationActions, "readFix")
    .mockResolvedValue(row as never) as AnySpy;
  jest
    .spyOn(WorkspaceRemediationActions, "authorize")
    .mockResolvedValue(memberProps as never);
  jest
    .spyOn(WorkspaceRemediationActions, "getLatePressAnswer")
    .mockResolvedValue(null as never);
  jest
    .spyOn(WorkspaceRemediationActions, "getApprovalDialog")
    .mockResolvedValue({
      title: "Approve this fix?",
      markdown: "**Incident INC-42:** Checkout slow",
      submitTitle: "Approve and run",
      cancelTitle: "Cancel",
      value: `${SUGGESTION_ID.toString()}:fedcba9876543210`,
    } as RemediationApprovalDialog as never);
  approve = jest
    .spyOn(WorkspaceRemediationActions, "approve")
    .mockResolvedValue({
      markdown: "✅ You approved this fix.",
      text: "You approved this fix",
    } as never) as AnySpy;
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

function handle(
  actionType: string,
  turn: FakeTurn,
  actionValue: string | undefined = VALUE,
): Promise<void> {
  return MicrosoftTeamsRemediationActions.handle({
    actionType,
    actionValue,
    projectId: PROJECT_ID,
    oneUptimeUserId: USER_ID,
    turnContext: turn.turnContext,
  });
}

describe("which presses are a fix's", () => {
  test("the card's buttons carry Slack's ids, which are the Teams ids", () => {
    for (const id of [
      SlackActionType.ViewApproveRemediation,
      SlackActionType.SubmitApproveRemediation,
      SlackActionType.DismissRemediation,
    ]) {
      expect(
        MicrosoftTeamsRemediationActions.isRemediationAction(
          getMicrosoftTeamsActionType(id),
        ),
      ).toBe(true);
    }

    expect(Object.values(MicrosoftTeamsRemediationActionType).sort()).toEqual(
      [
        SlackActionType.ViewApproveRemediation,
        SlackActionType.SubmitApproveRemediation,
        SlackActionType.DismissRemediation,
      ].sort(),
    );
    expect(
      MicrosoftTeamsRemediationActions.isRemediationAction(
        "AcknowledgeIncident",
      ),
    ).toBe(false);
  });
});

describe("Review and approve", () => {
  test("answers with an approval card; nothing runs yet", async () => {
    const turn: FakeTurn = createTurn();

    await handle(
      MicrosoftTeamsRemediationActionType.ViewApproveRemediation,
      turn,
    );

    expect(turn.replies).toHaveLength(1);

    const sent: JSONObject = card(turn.replies[0]);

    expect(sent["type"]).toBe("AdaptiveCard");
    expect(replyText(turn.replies[0])).toContain("Approve this fix?");
    expect(replyText(turn.replies[0])).toContain(
      "**Incident INC-42:** Checkout slow",
    );

    const actions: Array<JSONObject> = sent["actions"] as Array<JSONObject>;

    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: "Action.Submit",
      title: "Approve and run",
      style: "positive",
      data: {
        action: MicrosoftTeamsRemediationActionType.SubmitApproveRemediation,
        actionValue: `${SUGGESTION_ID.toString()}:fedcba9876543210`,
      },
    });
    expect(approve).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
  });

  test("a fix that is gone is said so", async () => {
    readFix.mockResolvedValue(null as never);
    const turn: FakeTurn = createTurn();

    await handle(
      MicrosoftTeamsRemediationActionType.ViewApproveRemediation,
      turn,
    );

    expect(replyText(turn.replies[0])).toContain(
      "This fix is no longer in OneUptime. It may have been deleted.",
    );
  });

  test("a press that came too late says who got there first", async () => {
    jest
      .spyOn(WorkspaceRemediationActions, "getLatePressAnswer")
      .mockResolvedValue({
        markdown: "This fix was already dismissed by **Maya Chen**.",
        text: "This fix was already dismissed by Maya Chen",
      } as never);
    const turn: FakeTurn = createTurn();

    await handle(
      MicrosoftTeamsRemediationActionType.ViewApproveRemediation,
      turn,
    );

    expect(replyText(turn.replies[0])).toContain(
      "This fix was already dismissed by **Maya Chen**.",
    );
    expect(approve).not.toHaveBeenCalled();
  });

  test("a member who may not approve is refused by the bot's own catch", async () => {
    jest
      .spyOn(WorkspaceRemediationActions, "authorize")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to approve this fix.",
        ) as never,
      );

    await expect(
      handle(
        MicrosoftTeamsRemediationActionType.ViewApproveRemediation,
        createTurn(),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("a value this app never wrote is refused before anything is read", async () => {
    await expect(
      handle(
        MicrosoftTeamsRemediationActionType.ViewApproveRemediation,
        createTurn(),
        "INC-42",
      ),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(readFix).not.toHaveBeenCalled();
  });
});

describe("Approve and run", () => {
  test("approves as the member, from Microsoft Teams, confirms it, then removes the approval card", async () => {
    const turn: FakeTurn = createTurn();

    await handle(
      MicrosoftTeamsRemediationActionType.SubmitApproveRemediation,
      turn,
    );

    const args: JSONObject = approve.mock.calls[0]![0] as JSONObject;

    expect(args["props"]).toBe(memberProps);
    expect(args["from"]).toBe(WorkspaceType.MicrosoftTeams);
    expect((args["value"] as JSONObject)["fingerprint"]).toBe(FINGERPRINT);
    expect(turn.deleted).toEqual(["approval-card-activity"]);
    // Confirmed where they pressed; the record's feed says the rest.
    expect(turn.replies).toHaveLength(1);
    expect(replyText(turn.replies[0])).toContain("✅ You approved this fix.");
  });

  test("a refused approval is thrown for the bot to tell, and the card stays", async () => {
    approve.mockRejectedValue(
      new BadDataException(
        "This fix changed after the message you pressed was posted, so nothing was done.",
      ) as never,
    );
    const turn: FakeTurn = createTurn();

    await expect(
      handle(
        MicrosoftTeamsRemediationActionType.SubmitApproveRemediation,
        turn,
      ),
    ).rejects.toThrow(
      "This fix changed after the message you pressed was posted",
    );
    expect(turn.deleted).toEqual([]);
    expect(turn.replies).toEqual([]);
  });
});

describe("Dismiss", () => {
  test("dismisses as the member and answers the presser", async () => {
    const turn: FakeTurn = createTurn();

    await handle(MicrosoftTeamsRemediationActionType.DismissRemediation, turn);

    expect(WorkspaceRemediationActions.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ action: "dismiss this fix" }),
    );
    expect(dismiss).toHaveBeenCalledWith(
      expect.objectContaining({
        props: memberProps,
        from: WorkspaceType.MicrosoftTeams,
      }),
    );
    expect(replyText(turn.replies[0])).toContain("You dismissed this fix.");
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("an account that is not connected", () => {
  test("is asked to connect it, and to press the button again", () => {
    expect(
      MicrosoftTeamsConnectPrompt.describe({
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
      MicrosoftTeamsConnectPrompt.describe({
        actionType: SlackActionType.DismissRemediation,
        actionValue: VALUE,
      }).again,
    ).toEqual({
      kind: WorkspaceConnectRequestAgainKind.Button,
      label: "Dismiss",
    });
  });
});

describe("the approval card", () => {
  test("is the dialog's title, its Markdown, and one positive Approve and run", () => {
    const built: JSONObject =
      MicrosoftTeamsRemediationActions.buildApprovalCard({
        title: "Approve this fix?",
        markdown: "Everything it runs",
        submitTitle: "Approve and run",
        cancelTitle: "Cancel",
        value: VALUE,
      });

    expect(built["version"]).toBe("1.5");
    expect(
      (built["body"] as Array<JSONObject>).map((element: JSONObject) => {
        return [element["text"], element["wrap"]];
      }),
    ).toEqual([
      ["Approve this fix?", true],
      ["Everything it runs", true],
    ]);
  });
});
