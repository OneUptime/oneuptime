import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackActionAnswer, {
  SlackAnswerDelivery,
  SlackAnswerPlace,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackAuthAction from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackConnectPrompt, {
  SlackPressDescription,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import { WorkspaceAnswer } from "../../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
  WorkspacePendingActionKind,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import URL from "../../../../../Types/API/URL";
import ObjectID from "../../../../../Types/ObjectID";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../../Types/Workspace/ConnectCallback";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";

/*
 * "CONNECT YOUR SLACK ACCOUNT TO ACKNOWLEDGE THIS INCIDENT."
 *
 * What somebody whose Slack account is not connected is asked, for each
 * button, form and command: what they pressed, in words (describe), and
 * the press kept behind a one-click Connect button for the account that
 * pressed it - with where to answer once it is connected (prompt). Customer
 * feedback #1 got "Unfortunately your slack account is not connected to
 * OneUptime. Please log into your OneUptime account, click on User Settings
 * and then connect your Slack account." - in a direct message, twice.
 */

jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "e0000000-0000-4000-8000-000000000001",
);
const RECORD_ID: string = "e0000000-0000-4000-8000-000000000002";
const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SETTINGS_PAGE: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`;

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface PendingCase {
  actionType: SlackActionType;
  purpose: string;
  kind: WorkspacePendingActionKind;
  eventType: WorkspaceEventType;
}

const PENDING: Array<PendingCase> = [
  {
    actionType: SlackActionType.AcknowledgeIncident,
    purpose: "acknowledge this incident",
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.Incident,
  },
  {
    actionType: SlackActionType.ResolveIncident,
    purpose: "resolve this incident",
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.Incident,
  },
  {
    actionType: SlackActionType.AcknowledgeAlert,
    purpose: "acknowledge this alert",
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.Alert,
  },
  {
    actionType: SlackActionType.ResolveAlert,
    purpose: "resolve this alert",
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.Alert,
  },
  {
    actionType: SlackActionType.AcknowledgeIncidentEpisode,
    purpose: "acknowledge this incident episode",
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.IncidentEpisode,
  },
  {
    actionType: SlackActionType.ResolveIncidentEpisode,
    purpose: "resolve this incident episode",
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.IncidentEpisode,
  },
  {
    actionType: SlackActionType.AcknowledgeAlertEpisode,
    purpose: "acknowledge this alert episode",
    kind: WorkspacePendingActionKind.Acknowledge,
    eventType: WorkspaceEventType.AlertEpisode,
  },
  {
    actionType: SlackActionType.ResolveAlertEpisode,
    purpose: "resolve this alert episode",
    kind: WorkspacePendingActionKind.Resolve,
    eventType: WorkspaceEventType.AlertEpisode,
  },
  {
    actionType: SlackActionType.MarkScheduledMaintenanceAsOngoing,
    purpose: "mark this scheduled maintenance event as ongoing",
    kind: WorkspacePendingActionKind.MarkAsOngoing,
    eventType: WorkspaceEventType.ScheduledMaintenance,
  },
  {
    actionType: SlackActionType.MarkScheduledMaintenanceAsComplete,
    purpose: "mark this scheduled maintenance event as complete",
    kind: WorkspacePendingActionKind.MarkAsComplete,
    eventType: WorkspaceEventType.ScheduledMaintenance,
  },
];

// A button that opens a form, or the form's submission: press it again.
const FORMS: Array<[SlackActionType, string, string]> = [
  [
    SlackActionType.ViewAddIncidentNote,
    "add a note to this incident",
    "Add Note",
  ],
  [
    SlackActionType.SubmitIncidentNote,
    "add a note to this incident",
    "Add Note",
  ],
  [
    SlackActionType.ViewChangeIncidentState,
    "change the state of this incident",
    "Change Incident State",
  ],
  [
    SlackActionType.SubmitExecuteIncidentOnCallPolicy,
    "execute an on-call policy for this incident",
    "Execute On Call",
  ],
  [SlackActionType.ViewAddAlertNote, "add a note to this alert", "Add Note"],
  [
    SlackActionType.SubmitChangeAlertState,
    "change the state of this alert",
    "Change Alert State",
  ],
  [
    SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy,
    "execute an on-call policy for this alert episode",
    "Execute On Call",
  ],
  [
    SlackActionType.ViewChangeIncidentEpisodeState,
    "change the state of this incident episode",
    "Change Episode State",
  ],
  [
    SlackActionType.SubmitScheduledMaintenanceNote,
    "add a note to this scheduled maintenance event",
    "Add Note",
  ],
  [
    SlackActionType.ViewChangeScheduledMaintenanceState,
    "change the state of this scheduled maintenance event",
    "Change State",
  ],
];

describe("SlackConnectPrompt.describe", () => {
  test.each(PENDING)(
    "$actionType: asks to $purpose, and keeps the press to finish it",
    (row: PendingCase) => {
      const description: SlackPressDescription = SlackConnectPrompt.describe({
        actionType: row.actionType,
        actionValue: RECORD_ID,
      });

      expect(description.purpose).toBe(row.purpose);
      expect(description.again).toBeUndefined();
      expect(description.pendingAction!.kind).toBe(row.kind);
      expect(description.pendingAction!.eventType).toBe(row.eventType);
      expect(description.pendingAction!.eventId.toString()).toBe(RECORD_ID);
    },
  );

  test.each([
    ["no value", undefined],
    ["a value that is not a record id", "not-an-id"],
    ["a value that tries to be two", `${RECORD_ID},${RECORD_ID}`],
  ])(
    "a button with %s is asked about, but never kept to finish",
    (_name: string, actionValue: string | undefined) => {
      expect(
        SlackConnectPrompt.describe({
          actionType: SlackActionType.AcknowledgeIncident,
          actionValue: actionValue,
        }),
      ).toEqual({ purpose: "acknowledge this incident" });
    },
  );

  test.each(FORMS)(
    "%s: asks to %s, then to press %s again (a form opens only on a fresh press)",
    (actionType: SlackActionType, purpose: string, button: string) => {
      expect(
        SlackConnectPrompt.describe({
          actionType: actionType,
          actionValue: RECORD_ID,
        }),
      ).toEqual({
        purpose: purpose,
        again: { kind: WorkspaceConnectRequestAgainKind.Button, label: button },
      });
    },
  );

  test.each([
    [SlackActionType.NewIncident, "declare an incident", "/oneuptime incident"],
    [
      SlackActionType.SubmitNewIncident,
      "declare an incident",
      "/oneuptime incident",
    ],
    [
      SlackActionType.NewScheduledMaintenance,
      "create a scheduled maintenance event",
      "/oneuptime maintenance",
    ],
    [
      SlackActionType.SubmitNewScheduledMaintenance,
      "create a scheduled maintenance event",
      "/oneuptime maintenance",
    ],
    [SlackActionType.ShowOnCall, "see who is on call", "/oneuptime oncall"],
  ])(
    "%s, with no command typed (a form's submission): asks to %s, then to run %s again",
    (actionType: SlackActionType, purpose: string, command: string) => {
      expect(
        SlackConnectPrompt.describe({
          actionType: actionType,
          payloadType: actionType.startsWith("/")
            ? undefined
            : "view_submission",
        }),
      ).toEqual({
        purpose: purpose,
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: command,
        },
      });
    },
  );

  test.each([
    // An app updated to the one /oneuptime command.
    [SlackActionType.NewIncident, "/oneuptime incident"],
    [SlackActionType.NewScheduledMaintenance, "/oneuptime maintenance"],
    [SlackActionType.ShowOnCall, "/oneuptime oncall"],
    // An app created from an older manifest: run what it has.
    [SlackActionType.NewIncident, "/incident"],
    [SlackActionType.NewScheduledMaintenance, "/maintenance"],
    // A workspace that runs OneUptime with a command of its own.
    [SlackActionType.NewIncident, "/irm incident"],
  ])(
    "%s typed as %s: run again exactly as it was typed",
    (actionType: SlackActionType, command: string) => {
      expect(
        SlackConnectPrompt.describe({
          actionType: actionType,
          command: command,
        }).again,
      ).toEqual({
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: command,
      });
    },
  );

  test("the shortcut that opens the maintenance form: press the shortcut again", () => {
    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.NewScheduledMaintenance,
        payloadType: "shortcut",
      }),
    ).toEqual({
      purpose: "create a scheduled maintenance event",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Create Scheduled Event",
      },
    });
  });

  test("the shortcut that opens the same form: press the shortcut again", () => {
    expect(
      SlackConnectPrompt.describe({
        actionType: SlackActionType.NewIncident,
        payloadType: "shortcut",
      }),
    ).toEqual({
      purpose: "declare an incident",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Create New Incident",
      },
    });
  });

  test("every button, form and command that needs a connected account says what it is for", () => {
    const generic: string = "use OneUptime from Slack";
    const vague: Array<string> = Object.values(SlackActionType).filter(
      (actionType: string): boolean => {
        return (
          SlackAuthAction.requiresConnectedAccount(
            actionType as SlackActionType,
          ) &&
          // Not a press: a reaction is answered by the reaction's own handler.
          actionType !== SlackActionType.EmojiReactionAdded &&
          SlackConnectPrompt.describe({
            actionType: actionType,
            actionValue: RECORD_ID,
          }).purpose === generic
        );
      },
    );

    expect(vague).toEqual([]);
  });

  test("anything else asks only to connect, in the product's name", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(SlackConnectPrompt.describe({ actionType: "SomethingNew" })).toEqual(
      { purpose: "use Acme Ops from Slack" },
    );
  });

  test("a question to OneUptime AI is asked again once connected", () => {
    expect(SlackConnectPrompt.describeQuestion()).toEqual({
      purpose: "ask OneUptime AI",
      again: { kind: WorkspaceConnectRequestAgainKind.Question },
    });
  });
});

describe("SlackConnectPrompt.prompt", () => {
  let answered: jest.SpyInstance;

  function placeOfPress(): SlackAnswerPlace {
    return {
      projectAuthToken: "xoxb-project-token",
      slackUserId: "U0NITIN",
      slackChannelId: "C0INC2",
      slackThreadTs: "1760000000.000100",
      responseUrl: "https://hooks.slack.com/actions/T0TEAM/1/abc",
    };
  }

  // What the presser was answered with, and the Connect button's link.
  function theAnswer(): { answer: WorkspaceAnswer; connectUrl: string | null } {
    expect(answered).toHaveBeenCalledTimes(1);

    const call: { answer: WorkspaceAnswer; connectUrl?: URL | undefined } =
      answered.mock.calls[0]![0];

    expect(call).toMatchObject({ place: placeOfPress() });

    return {
      answer: call.answer,
      connectUrl: call.connectUrl ? call.connectUrl.toString() : null,
    };
  }

  beforeEach(() => {
    (GlobalCache as unknown as { store: Map<string, unknown> }).store.clear();
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    answered = jest
      .spyOn(SlackActionAnswer, "answer")
      .mockResolvedValue(SlackAnswerDelivery.ResponseUrl);
  });

  test("keeps the press for the account that pressed it, with where to answer, behind a one-click Connect button", async () => {
    const delivery: SlackAnswerDelivery = await SlackConnectPrompt.prompt({
      projectId: PROJECT_ID,
      place: placeOfPress(),
      slackTeamId: "T0TEAM",
      description: SlackConnectPrompt.describe({
        actionType: SlackActionType.AcknowledgeIncident,
        actionValue: RECORD_ID,
      }),
    });

    expect(delivery).toBe(SlackAnswerDelivery.ResponseUrl);

    const { answer, connectUrl } = theAnswer();

    expect(answer).toEqual({
      markdown:
        "🔗 **Connect your Slack account to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
      text: "Connect your Slack account to acknowledge this incident",
    });

    const url: globalThis.URL = new globalThis.URL(connectUrl || "");
    const token: string | null = url.searchParams.get("connect");

    expect(`${url.origin}${url.pathname}`).toBe(SETTINGS_PAGE);
    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

    const request: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);

    expect(request).toMatchObject({
      workspaceType: WorkspaceType.Slack,
      workspaceUserId: "U0NITIN",
      purpose: "acknowledge this incident",
      slack: {
        teamId: "T0TEAM",
        channelId: "C0INC2",
        threadTs: "1760000000.000100",
        responseUrl: "https://hooks.slack.com/actions/T0TEAM/1/abc",
      },
    });
    expect(request!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(request!.pendingAction!.kind).toBe(
      WorkspacePendingActionKind.Acknowledge,
    );
    expect(request!.pendingAction!.eventId.toString()).toBe(RECORD_ID);
  });

  test("each press gets a Connect button of its own: two presses, two answers, two tokens", async () => {
    for (let press: number = 0; press < 2; press++) {
      await SlackConnectPrompt.prompt({
        projectId: PROJECT_ID,
        place: placeOfPress(),
        description: SlackConnectPrompt.describe({
          actionType: SlackActionType.AcknowledgeIncident,
          actionValue: RECORD_ID,
        }),
      });
    }

    expect(answered).toHaveBeenCalledTimes(2);

    const tokens: Array<string | null> = answered.mock.calls.map(
      (call: Array<{ connectUrl: URL }>): string | null => {
        return new globalThis.URL(
          call[0]!.connectUrl.toString(),
        ).searchParams.get("connect");
      },
    );

    expect(new Set(tokens).size).toBe(2);
  });

  test("when the press cannot be kept, it still asks to connect, links the settings page, and says to press again", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValueOnce(new Error("Redis is down"));
    jest.spyOn(logger, "error").mockImplementation(() => {});

    await SlackConnectPrompt.prompt({
      projectId: PROJECT_ID,
      place: placeOfPress(),
      description: SlackConnectPrompt.describe({
        actionType: SlackActionType.AcknowledgeIncident,
        actionValue: RECORD_ID,
      }),
    });

    expect(theAnswer()).toEqual({
      answer: {
        markdown:
          "🔗 **Connect your Slack account to acknowledge this incident.** Once you're connected, press the button again.",
        text: "Connect your Slack account to acknowledge this incident",
      },
      connectUrl: SETTINGS_PAGE,
    });
  });

  test("with no address to link to, it says where the setting is, with no button", async () => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("No host is configured."));

    await SlackConnectPrompt.prompt({
      projectId: PROJECT_ID,
      place: placeOfPress(),
      description: SlackConnectPrompt.describe({
        actionType: SlackActionType.NewIncident,
      }),
    });

    expect(theAnswer()).toEqual({
      answer: {
        markdown:
          "🔗 **Connect your Slack account to declare an incident.** In OneUptime, go to **User Settings → Workspace → Slack** and press **Connect my account with Slack**. Once you're connected, run **/oneuptime incident** again.",
        text: "Connect your Slack account to declare an incident",
      },
      connectUrl: null,
    });
  });
});
