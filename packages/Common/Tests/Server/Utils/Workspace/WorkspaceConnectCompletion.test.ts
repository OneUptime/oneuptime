import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import logger from "../../../../Server/Utils/Logger";
import OnCallPersonPageAnswer from "../../../../Server/Utils/OnCall/OnCallPersonPageAnswer";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAnswers from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
  WorkspacePendingActionKind,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventStanding,
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import MicrosoftTeamsReactionNoteSync from "../../../../Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";
import SlackReactionNoteActions from "../../../../Server/Utils/Workspace/Slack/Actions/ReactionNote";
import WorkspaceReactionNote, {
  WorkspaceMessageNoteOutcome,
  WorkspaceMessageNoteResult,
  WorkspaceNoteResourceType,
} from "../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { ConnectRequestOutcome } from "../../../../Types/Workspace/ConnectCallback";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * FINISHING A PRESS ONCE THE ACCOUNT IS CONNECTED.
 *
 * Somebody pressed Acknowledge before their Slack or Microsoft Teams
 * account was connected, pressed the Connect button they were answered
 * with, and signed in. What they pressed is finished now, as the member
 * the account was just connected to, with every check the button makes:
 * their membership, their permission on the state change, their read of
 * the record. These pin what is done, what is said back in the chat, and
 * what the settings page is told - and that nothing is done for a member
 * the checks refuse.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("f0000000-0000-4000-8000-000000000002");
const INCIDENT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000003",
);

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

const INCIDENT_LINK: string = `https://oneuptime.test/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

function request(
  overrides?: Partial<WorkspaceConnectRequestRecord>,
): WorkspaceConnectRequestRecord {
  return {
    workspaceType: WorkspaceType.Slack,
    projectId: PROJECT_ID,
    workspaceUserId: "U0NITIN",
    purpose: "acknowledge this incident",
    pendingAction: {
      kind: WorkspacePendingActionKind.Acknowledge,
      eventType: WorkspaceEventType.Incident,
      eventId: INCIDENT_ID,
    },
    slack: { teamId: "T0TEAM", channelId: "C0INC2" },
    expiresAt: new Date(Date.now() + 60000),
    ...overrides,
  };
}

const CREATED_STATE_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000004",
);

function incident(): WorkspaceEventRecord {
  return {
    type: WorkspaceEventType.Incident,
    id: INCIDENT_ID,
    projectId: PROJECT_ID,
    currentStateId: CREATED_STATE_ID,
    number: 2,
    numberWithPrefix: "INC-2",
  };
}

function standing(
  overrides?: Partial<WorkspaceEventStanding>,
): WorkspaceEventStanding {
  return {
    isAcknowledged: false,
    isResolved: false,
    hasStarted: false,
    isComplete: false,
    ...overrides,
  };
}

let memberProps: jest.SpyInstance;
let authorize: jest.SpyInstance;
let getStanding: jest.SpyInstance;
let acknowledge: jest.SpyInstance;
let resolve: jest.SpyInstance;
let markAsOngoing: jest.SpyInstance;
let logPressed: jest.SpyInstance;

beforeEach(() => {
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  memberProps = jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(MEMBER_PROPS);
  authorize = jest
    .spyOn(WorkspaceMemberActions, "authorize")
    .mockResolvedValue(incident());
  getStanding = jest
    .spyOn(WorkspaceMemberActions, "getStanding")
    .mockResolvedValue(standing());
  acknowledge = jest
    .spyOn(WorkspaceMemberActions, "acknowledge")
    .mockResolvedValue(undefined);
  resolve = jest
    .spyOn(WorkspaceMemberActions, "resolve")
    .mockResolvedValue(undefined);
  markAsOngoing = jest
    .spyOn(WorkspaceMemberActions, "markScheduledMaintenanceAsOngoing")
    .mockResolvedValue(undefined);
  logPressed = jest
    .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString(INCIDENT_LINK));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a press OneUptime finishes", () => {
  test("Acknowledge: done as the member, with the button's checks, logged as the button's press, and answered with the news", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request(),
        userId: USER_ID,
      });

    // The member the account was just connected to, in the press's project.
    expect(memberProps).toHaveBeenCalledWith({
      userId: USER_ID,
      projectId: PROJECT_ID,
    });
    // The button's own check: the state change, the record, in their words.
    expect(authorize).toHaveBeenCalledWith({
      props: MEMBER_PROPS,
      modelType: IncidentStateTimeline,
      action: "acknowledge this incident",
      event: { type: WorkspaceEventType.Incident, id: INCIDENT_ID },
    });
    expect(acknowledge).toHaveBeenCalledWith({
      event: incident(),
      props: MEMBER_PROPS,
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(logPressed).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        userId: USER_ID,
        buttonAction: "acknowledge_incident",
        channelId: "C0INC2",
        incidentId: INCIDENT_ID,
      },
      { isRoot: true },
    );

    // Done: the settings page may say OneUptime finished what was pressed.
    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown: `✅ **Your Slack account is connected to OneUptime.** You acknowledged **[Incident INC-2](${INCIDENT_LINK})**.`,
        text: "Your Slack account is connected to OneUptime. You acknowledged Incident INC-2",
      },
    });
  });

  test.each([
    {
      kind: WorkspacePendingActionKind.Resolve,
      eventType: WorkspaceEventType.Alert,
      modelType: AlertStateTimeline,
      purpose: "resolve this alert",
      done: "resolve" as const,
      logged: "resolve_alert",
    },
    {
      kind: WorkspacePendingActionKind.MarkAsComplete,
      eventType: WorkspaceEventType.ScheduledMaintenance,
      modelType: ScheduledMaintenanceStateTimeline,
      purpose: "mark this scheduled maintenance event as complete",
      done: "resolve" as const,
      logged: "mark_scheduled_maintenance_as_complete",
    },
    {
      kind: WorkspacePendingActionKind.MarkAsOngoing,
      eventType: WorkspaceEventType.ScheduledMaintenance,
      modelType: ScheduledMaintenanceStateTimeline,
      purpose: "mark this scheduled maintenance event as ongoing",
      done: "markAsOngoing" as const,
      logged: "mark_scheduled_maintenance_as_ongoing",
    },
  ])(
    "$kind on a $eventType: the same change the button makes",
    async (row: {
      kind: WorkspacePendingActionKind;
      eventType: WorkspaceEventType;
      modelType: unknown;
      purpose: string;
      done: "resolve" | "markAsOngoing";
      logged: string;
    }) => {
      const recordId: ObjectID = ObjectID.generate();
      const record: WorkspaceEventRecord = {
        ...incident(),
        type: row.eventType,
        id: recordId,
      };
      authorize.mockResolvedValue(record);
      jest
        .spyOn(AlertService, "getAlertLinkInDashboard")
        .mockResolvedValue(URL.fromString("https://oneuptime.test/alert"));
      jest
        .spyOn(
          ScheduledMaintenanceService,
          "getScheduledMaintenanceLinkInDashboard",
        )
        .mockResolvedValue(URL.fromString("https://oneuptime.test/sm"));

      const result: WorkspaceConnectCompletionResult =
        await WorkspaceConnectCompletion.complete({
          request: request({
            purpose: row.purpose,
            pendingAction: {
              kind: row.kind,
              eventType: row.eventType,
              eventId: recordId,
            },
          }),
          userId: USER_ID,
        });

      expect(result.outcome).toBe(ConnectRequestOutcome.Done);
      expect(authorize.mock.calls[0]![0]).toMatchObject({
        modelType: row.modelType,
        action: row.purpose,
        event: { type: row.eventType, id: recordId },
      });
      expect(
        row.done === "resolve" ? resolve : markAsOngoing,
      ).toHaveBeenCalledWith({ event: record, props: MEMBER_PROPS });
      expect(acknowledge).not.toHaveBeenCalled();
      expect(logPressed.mock.calls[0]![0]).toMatchObject({
        buttonAction: row.logged,
      });
    },
  );

  test("a press somebody got to first is not done again: who did it, as news", async () => {
    getStanding.mockResolvedValue(standing({ isAcknowledged: true }));
    // No page of theirs about it to answer.
    const pagesAnswered: jest.SpyInstance = jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(0);
    const already: jest.SpyInstance = jest
      .spyOn(WorkspaceActionAnswers, "getAlreadyAnswer")
      .mockResolvedValue({
        markdown: `✅ **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:07:00Z)}}.`,
        text: "Incident INC-2 was already acknowledged by Simon Lee",
      });

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request(),
        userId: USER_ID,
      });

    expect(acknowledge).not.toHaveBeenCalled();
    expect(logPressed).not.toHaveBeenCalled();
    expect(pagesAnswered).toHaveBeenCalledWith({
      kind: "incident",
      recordId: INCIDENT_ID,
      projectId: PROJECT_ID,
      pressedByUserId: USER_ID,
      isResolved: false,
    });
    expect(already).toHaveBeenCalledWith({
      event: incident(),
      press: "Acknowledge",
      answeredPageCount: 0,
    });
    // Answered, not done: somebody else did it, and the chat says who.
    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Answered,
      answer: {
        markdown: `✅ **Your Slack account is connected to OneUptime.** **[Incident INC-2](${INCIDENT_LINK})** was already acknowledged by **Simon Lee** at {{TIME(2026-10-08T18:07:00Z)}}.`,
        text: "Your Slack account is connected to OneUptime. Incident INC-2 was already acknowledged by Simon Lee",
      },
    });
  });

  /*
   * Paged into the incident by a person's page (UI review of block 31):
   * their Acknowledge, finished once connected, answers that page, as the
   * button does for somebody connected already.
   */
  test("Acknowledge on an incident somebody else is on answers the presser's own page about it, and the answer is told so", async () => {
    getStanding.mockResolvedValue(standing({ isAcknowledged: true }));
    jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(1);
    const already: jest.SpyInstance = jest
      .spyOn(WorkspaceActionAnswers, "getAlreadyAnswer")
      .mockResolvedValue({
        markdown: `✅ You acknowledged the page for **[Incident INC-2](${INCIDENT_LINK})**, so paging stopped.`,
        text: "You acknowledged the page for Incident INC-2, so paging stopped",
      });

    await WorkspaceConnectCompletion.complete({
      request: request(),
      userId: USER_ID,
    });

    expect(acknowledge).not.toHaveBeenCalled();
    expect(already).toHaveBeenCalledWith({
      event: incident(),
      press: "Acknowledge",
      answeredPageCount: 1,
    });
  });

  test("Resolve on a resolved incident answers no page: only Acknowledge does", async () => {
    getStanding.mockResolvedValue(
      standing({ isAcknowledged: true, isResolved: true }),
    );
    const pagesAnswered: jest.SpyInstance = jest
      .spyOn(OnCallPersonPageAnswer, "onAcknowledgePressed")
      .mockResolvedValue(0);
    jest.spyOn(WorkspaceActionAnswers, "getAlreadyAnswer").mockResolvedValue({
      markdown: `✅ **[Incident INC-2](${INCIDENT_LINK})** is already resolved.`,
      text: "Incident INC-2 is already resolved",
    });

    await WorkspaceConnectCompletion.complete({
      request: request({
        purpose: "resolve this incident",
        pendingAction: {
          kind: WorkspacePendingActionKind.Resolve,
          eventType: WorkspaceEventType.Incident,
          eventId: INCIDENT_ID,
        },
      }),
      userId: USER_ID,
    });

    expect(pagesAnswered).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the account's user is not a member of the project",
      "member",
      new NotAuthorizedException(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      ),
    ],
    [
      "the member may not acknowledge incidents",
      "authorize",
      new NotAuthorizedException(
        "You do not have permission to acknowledge this incident.",
      ),
    ],
    [
      "the incident is outside what the member may read",
      "authorize",
      new NotAuthorizedException(
        `You do not have permission to acknowledge this incident: ${WorkspaceActionAuthorization.getNotIncludedReason("incident")}`,
      ),
    ],
    [
      "the incident was deleted since the button was posted",
      "authorize",
      new NotAuthorizedException(
        `Could not acknowledge this incident: ${WorkspaceActionAuthorization.getNotFoundReason("incident")}`,
      ),
    ],
  ])(
    "%s: nothing is done, and the refusal is said as the button says it",
    async (_name: string, where: string, refusal: Error) => {
      (where === "member" ? memberProps : authorize).mockRejectedValue(refusal);

      const result: WorkspaceConnectCompletionResult =
        await WorkspaceConnectCompletion.complete({
          request: request(),
          userId: USER_ID,
        });

      expect(acknowledge).not.toHaveBeenCalled();
      expect(logPressed).not.toHaveBeenCalled();
      expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
      expect(result.answer.markdown).toBe(
        `✅ **Your Slack account is connected to OneUptime.** ${refusal.message}`,
      );
    },
  );

  test("a failure is logged, and the person told to press again - the account is connected either way", async () => {
    acknowledge.mockRejectedValue(new Error("Connection terminated"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request(),
        userId: USER_ID,
      });

    expect(errorLog).toHaveBeenCalledWith(
      "Could not finish a press once its chat account was connected.",
      { projectId: PROJECT_ID.toString() },
    );
    expect(result.answer.markdown).toBe(
      "✅ **Your Slack account is connected to OneUptime.** OneUptime could not acknowledge this incident just now. Please press the button again.",
    );
    // Never what failed.
    expect(result.answer.markdown).not.toContain("Connection terminated");
    // Not done: the settings page must not say it was finished.
    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
  });

  test("a refusal that names something with Markdown in it is said as text", async () => {
    authorize.mockRejectedValue(
      new NotAuthorizedException(
        'You do not have permission to use the label "**Prod** [docs](https://evil.test)".',
      ),
    );

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request(),
        userId: USER_ID,
      });

    expect(result.answer.markdown).toContain("\\*\\*Prod\\*\\*");
    expect(result.answer.markdown).toContain("\\[docs\\]");
  });

  test("in Microsoft Teams, it says Microsoft Teams, and logs the conversation", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          workspaceType: WorkspaceType.MicrosoftTeams,
          slack: undefined,
          teams: {
            serviceUrl: "https://smba.trafficmanager.net/amer/",
            conversationId: "19:incident@thread.tacv2;messageid=1",
          },
        }),
        userId: USER_ID,
      });

    expect(
      result.answer.markdown.startsWith(
        "✅ **Your Microsoft Teams account is connected to OneUptime.**",
      ),
    ).toBe(true);
    expect(logPressed.mock.calls[0]![0]).toMatchObject({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: "19:incident@thread.tacv2;messageid=1",
    });
  });
});

describe("a press OneUptime cannot finish for them", () => {
  test("a form's button: connected, and told to press it again", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          purpose: "add a note to this incident",
          pendingAction: undefined,
          again: {
            kind: WorkspaceConnectRequestAgainKind.Button,
            label: "Add Note",
          },
        }),
        userId: USER_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.PressAgain,
      answer: {
        markdown:
          "✅ **Your Slack account is connected to OneUptime.** Now press **Add Note** again.",
        text: "Your Slack account is connected to OneUptime. Now press Add Note again.",
      },
    });
    // Nothing is read or done on the member's behalf.
    expect(memberProps).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  /*
   * A question to OneUptime AI - an @mention, a direct message - has no
   * button to press again: the chat says to ask it again, and so does the
   * settings page, which used to say "press the button again" (#4768).
   */
  test.each([
    [
      WorkspaceType.Slack,
      {
        markdown:
          "✅ **Your Slack account is connected to OneUptime.** Now ask your question again.",
        text: "Your Slack account is connected to OneUptime. Now ask your question again.",
      },
    ],
    [
      WorkspaceType.MicrosoftTeams,
      {
        markdown:
          "✅ **Your Microsoft Teams account is connected to OneUptime.** Now ask your question again.",
        text: "Your Microsoft Teams account is connected to OneUptime. Now ask your question again.",
      },
    ],
  ])(
    "a question asked in %s: connected, and told to ask it again - in the chat, and on the page",
    async (
      workspaceType: WorkspaceType,
      answer: { markdown: string; text: string },
    ) => {
      const result: WorkspaceConnectCompletionResult =
        await WorkspaceConnectCompletion.complete({
          request: request({
            workspaceType: workspaceType,
            purpose: "ask OneUptime AI",
            pendingAction: undefined,
            again: { kind: WorkspaceConnectRequestAgainKind.Question },
          }),
          userId: USER_ID,
        });

      expect(result).toEqual({
        outcome: ConnectRequestOutcome.AskAgain,
        answer: answer,
      });
      // The question is not asked for them: nothing is read as the member.
      expect(memberProps).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  test("a command: connected, and told to run it again", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          purpose: "declare an incident",
          pendingAction: undefined,
          again: {
            kind: WorkspaceConnectRequestAgainKind.Command,
            label: "/oneuptime incident",
          },
        }),
        userId: USER_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.RunAgain,
      answer: {
        markdown:
          "✅ **Your Slack account is connected to OneUptime.** Now run **/oneuptime incident** again.",
        text: "Your Slack account is connected to OneUptime. Now run /oneuptime incident again.",
      },
    });
  });

  test("anything else: connected, and nothing more to say", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          purpose: "use OneUptime from Slack",
          pendingAction: undefined,
        }),
        userId: USER_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Answered,
      answer: {
        markdown: "✅ **Your Slack account is connected to OneUptime.**",
        text: "Your Slack account is connected to OneUptime",
      },
    });
  });
});

describe("WorkspaceConnectCompletion.getAgainOutcome: what the settings page says to do again", () => {
  test("a question is asked again, whatever else it carries", () => {
    expect(
      WorkspaceConnectCompletion.getAgainOutcome({
        kind: WorkspaceConnectRequestAgainKind.Question,
      }),
    ).toBe(ConnectRequestOutcome.AskAgain);
    expect(
      WorkspaceConnectCompletion.getAgainOutcome({
        kind: WorkspaceConnectRequestAgainKind.Question,
        label: "which monitors are down?",
      }),
    ).toBe(ConnectRequestOutcome.AskAgain);
  });

  /*
   * A menu item (Change Severity, from an incident message's menu) is what
   * a button is to the page: the chat itself says to choose it from the
   * menu.
   */
  test.each([
    [WorkspaceConnectRequestAgainKind.Button, "Add Note"],
    [WorkspaceConnectRequestAgainKind.Button, undefined],
    [WorkspaceConnectRequestAgainKind.MenuItem, "Change Severity"],
    [WorkspaceConnectRequestAgainKind.MenuItem, undefined],
  ])(
    "a %s (%s) is pressed again",
    (kind: WorkspaceConnectRequestAgainKind, label: string | undefined) => {
      expect(
        WorkspaceConnectCompletion.getAgainOutcome(
          label ? { kind: kind, label: label } : { kind: kind },
        ),
      ).toBe(ConnectRequestOutcome.PressAgain);
    },
  );

  /*
   * A command - /oneuptime incident, "oncall" typed to the Teams bot - is
   * run (typed) again: the page used to say "press the button again" for
   * it, though no button sent it.
   */
  test.each([
    ["/oneuptime incident"],
    ["/incident"],
    ["oncall"],
    ["show active incidents"],
    [undefined],
  ])("a command (%s) is run again", (label: string | undefined) => {
    expect(
      WorkspaceConnectCompletion.getAgainOutcome(
        label
          ? { kind: WorkspaceConnectRequestAgainKind.Command, label: label }
          : { kind: WorkspaceConnectRequestAgainKind.Command },
      ),
    ).toBe(ConnectRequestOutcome.RunAgain);
  });

  test("nothing to do again: the chat has the whole answer", () => {
    expect(WorkspaceConnectCompletion.getAgainOutcome(undefined)).toBe(
      ConnectRequestOutcome.Answered,
    );
  });

  test("every kind of thing to do again has an outcome the page has a sentence for", () => {
    for (const kind of Object.values(WorkspaceConnectRequestAgainKind)) {
      expect(Object.values(ConnectRequestOutcome)).toContain(
        WorkspaceConnectCompletion.getAgainOutcome({ kind: kind }),
      );
    }
  });
});

describe("WorkspaceConnectCompletion.getLoggedButtonAction", () => {
  test.each([
    [
      WorkspacePendingActionKind.Acknowledge,
      WorkspaceEventType.Incident,
      "acknowledge_incident",
    ],
    [
      WorkspacePendingActionKind.Resolve,
      WorkspaceEventType.Alert,
      "resolve_alert",
    ],
    [
      WorkspacePendingActionKind.Acknowledge,
      WorkspaceEventType.IncidentEpisode,
      "acknowledge_incident_episode",
    ],
    [
      WorkspacePendingActionKind.Resolve,
      WorkspaceEventType.AlertEpisode,
      "resolve_alert_episode",
    ],
    [
      WorkspacePendingActionKind.MarkAsOngoing,
      WorkspaceEventType.ScheduledMaintenance,
      "mark_scheduled_maintenance_as_ongoing",
    ],
    [
      WorkspacePendingActionKind.SavePrivateNote,
      WorkspaceEventType.Incident,
      "save_incident_private_note",
    ],
    [
      WorkspacePendingActionKind.SavePublicNote,
      WorkspaceEventType.ScheduledMaintenance,
      "save_scheduled_maintenance_public_note",
    ],
  ])(
    "%s on a %s is logged as %s, as the button's own press is",
    (
      kind: WorkspacePendingActionKind,
      eventType: WorkspaceEventType,
      logged: string,
    ) => {
      expect(
        WorkspaceConnectCompletion.getLoggedButtonAction({
          kind: kind,
          eventType: eventType,
          eventId: INCIDENT_ID,
        }),
      ).toBe(logged);
    },
  );
});

describe("a pinned message, saved once the account is connected", () => {
  /*
   * Jane pinned a message before her account was connected. Connecting
   * saves it, as her pin would have: SlackReactionNoteActions.saveMessage
   * in Slack, MicrosoftTeamsReactionNoteSync.saveAfterConnect in Microsoft
   * Teams (their own suites hold how). This holds what is asked of them,
   * and what the chat and the settings page are told of each outcome.
   */
  const MESSAGE: { channelId: string; messageId: string } = {
    channelId: "C0INC2",
    messageId: "1760000000.000200",
  };

  let slackSave: jest.SpyInstance;
  let teamsSave: jest.SpyInstance;

  function notePress(
    overrides?: Partial<WorkspaceConnectRequestRecord>,
    kind?: WorkspacePendingActionKind,
  ): WorkspaceConnectRequestRecord {
    return request({
      workspaceUserId: "U0JANE",
      purpose: "save the message you pinned as a private note on this incident",
      pendingAction: {
        kind: kind || WorkspacePendingActionKind.SavePrivateNote,
        eventType: WorkspaceEventType.Incident,
        eventId: INCIDENT_ID,
        message: MESSAGE,
      },
      ...overrides,
    });
  }

  beforeEach(() => {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.authToken = "xoxb-project";
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    slackSave = jest
      .spyOn(SlackReactionNoteActions, "saveMessage")
      .mockResolvedValue({ outcome: WorkspaceMessageNoteOutcome.Saved });
    teamsSave = jest
      .spyOn(MicrosoftTeamsReactionNoteSync, "saveAfterConnect")
      .mockResolvedValue({ outcome: WorkspaceMessageNoteOutcome.Saved });

    jest.spyOn(WorkspaceReactionNote, "getResourceDisplay").mockResolvedValue({
      label: "Incident INC-2",
      link: URL.fromString(INCIDENT_LINK),
    });
  });

  test("Slack: saved as the member, in the message's channel, and answered as done", async () => {
    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: notePress(),
        userId: USER_ID,
      });

    expect(slackSave).toHaveBeenCalledWith({
      requester: {
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectAuthToken: "xoxb-project",
        slackUserId: "U0JANE",
        slackChannelId: "C0INC2",
      },
      resource: {
        resourceType: WorkspaceNoteResourceType.Incident,
        resourceId: INCIDENT_ID,
        projectId: PROJECT_ID,
      },
      noteType: WorkspaceNoteType.Private,
      channelId: "C0INC2",
      messageTs: "1760000000.000200",
      // Answered here, as a whole.
      tellPerson: false,
    });
    expect(teamsSave).not.toHaveBeenCalled();
    // Not a state change: nothing of the button's is asked or done.
    expect(authorize).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown: `✅ **Your Slack account is connected to OneUptime.** You saved the message as a private note on **[Incident INC-2](${INCIDENT_LINK})**.`,
        text: "Your Slack account is connected to OneUptime. You saved the message as a private note on Incident INC-2",
      },
    });
  });

  test("Microsoft Teams: the channel is read again for her reaction, and a public note is said so", async () => {
    const teamsMessage: {
      channelId: string;
      messageId: string;
      teamId: string;
    } = {
      channelId: "19:inc-2@thread.tacv2",
      messageId: "1760000000200",
      teamId: "graph-team-ops",
    };

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: "aad-jane",
          purpose:
            "save the message you reacted to as a public note on this incident",
          pendingAction: {
            kind: WorkspacePendingActionKind.SavePublicNote,
            eventType: WorkspaceEventType.Incident,
            eventId: INCIDENT_ID,
            message: teamsMessage,
          },
          slack: undefined,
        }),
        userId: USER_ID,
      });

    expect(teamsSave).toHaveBeenCalledWith({
      resource: {
        resourceType: WorkspaceNoteResourceType.Incident,
        resourceId: INCIDENT_ID,
        projectId: PROJECT_ID,
      },
      noteType: WorkspaceNoteType.Public,
      message: teamsMessage,
      workspaceUserId: "aad-jane",
    });
    expect(slackSave).not.toHaveBeenCalled();
    expect(result.outcome).toBe(ConnectRequestOutcome.Done);
    expect(result.answer.markdown).toBe(
      `✅ **Your Microsoft Teams account is connected to OneUptime.** You saved the message as a public note on **[Incident INC-2](${INCIDENT_LINK})**.`,
    );
  });

  /*
   * A private incident takes no public notes (Types/StatusPage/
   * PrivateRecordPublicNotes): a 📣 there - private when Jane reacted, or
   * made private since - is saved as a private note, and the answer says
   * what it was saved as, never "a public note".
   */
  test.each([
    [WorkspaceType.Slack, "Slack"],
    [WorkspaceType.MicrosoftTeams, "Microsoft Teams"],
  ])(
    "%s: a 📣 saved as a private note, on a private incident, is answered as one",
    async (workspaceType: WorkspaceType, chatName: string) => {
      slackSave.mockResolvedValue({
        outcome: WorkspaceMessageNoteOutcome.Saved,
        noteType: WorkspaceNoteType.Private,
      });
      teamsSave.mockResolvedValue({
        outcome: WorkspaceMessageNoteOutcome.Saved,
        noteType: WorkspaceNoteType.Private,
      });

      const result: WorkspaceConnectCompletionResult =
        await WorkspaceConnectCompletion.complete({
          request:
            workspaceType === WorkspaceType.Slack
              ? notePress(
                  {
                    purpose:
                      "save the message you reacted to as a private note on this incident",
                  },
                  WorkspacePendingActionKind.SavePublicNote,
                )
              : request({
                  workspaceType: WorkspaceType.MicrosoftTeams,
                  workspaceUserId: "aad-jane",
                  purpose:
                    "save the message you reacted to as a private note on this incident",
                  pendingAction: {
                    kind: WorkspacePendingActionKind.SavePublicNote,
                    eventType: WorkspaceEventType.Incident,
                    eventId: INCIDENT_ID,
                    message: {
                      channelId: "19:inc-2@thread.tacv2",
                      messageId: "1760000000200",
                      teamId: "graph-team-ops",
                    },
                  },
                  slack: undefined,
                }),
          userId: USER_ID,
        });

      // Asked for as the 📣 it was: the chat finds the reaction by its kind.
      const save: jest.SpyInstance =
        workspaceType === WorkspaceType.Slack ? slackSave : teamsSave;
      expect(save.mock.calls[0]![0].noteType).toBe(WorkspaceNoteType.Public);

      expect(result).toEqual({
        outcome: ConnectRequestOutcome.Done,
        answer: {
          markdown: `✅ **Your ${chatName} account is connected to OneUptime.** You saved the message as a private note on **[Incident INC-2](${INCIDENT_LINK})**.`,
          text: `Your ${chatName} account is connected to OneUptime. You saved the message as a private note on Incident INC-2`,
        },
      });
    },
  );

  test("a 📣 saved as asked is answered as a public note, as always", async () => {
    slackSave.mockResolvedValue({
      outcome: WorkspaceMessageNoteOutcome.Saved,
      noteType: WorkspaceNoteType.Public,
    });

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: notePress(
          {
            purpose:
              "save the message you reacted to as a public note on this incident",
          },
          WorkspacePendingActionKind.SavePublicNote,
        ),
        userId: USER_ID,
      });

    expect(result.answer.text).toBe(
      "Your Slack account is connected to OneUptime. You saved the message as a public note on Incident INC-2",
    );
  });

  test.each([
    [
      "saved by somebody else meanwhile",
      { outcome: WorkspaceMessageNoteOutcome.AlreadySaved },
      `✅ **Your Slack account is connected to OneUptime.** This message is already saved as a note on **[Incident INC-2](${INCIDENT_LINK})**.`,
      "Your Slack account is connected to OneUptime. This message is already saved as a note on Incident INC-2",
    ],
    [
      "refused, with why as text",
      {
        outcome: WorkspaceMessageNoteOutcome.Refused,
        reason:
          "You do not have permission to add a private note to this incident: the label *Payments* is not yours.",
      },
      "✅ **Your Slack account is connected to OneUptime.** You do not have permission to add a private note to this incident: the label \\*Payments\\* is not yours.",
      "Your Slack account is connected to OneUptime. You do not have permission to add a private note to this incident: the label *Payments* is not yours.",
    ],
    [
      "nothing to save",
      {
        outcome: WorkspaceMessageNoteOutcome.NothingToSave,
        reason: "The message you pinned has no text to save as a note.",
      },
      "✅ **Your Slack account is connected to OneUptime.** The message you pinned has no text to save as a note.",
      "Your Slack account is connected to OneUptime. The message you pinned has no text to save as a note.",
    ],
    [
      "the message gone",
      { outcome: WorkspaceMessageNoteOutcome.NotFound },
      "✅ **Your Slack account is connected to OneUptime.** The message is no longer there, so nothing was saved.",
      "Your Slack account is connected to OneUptime. The message is no longer there, so nothing was saved",
    ],
    [
      "a failure",
      { outcome: WorkspaceMessageNoteOutcome.Failed },
      "✅ **Your Slack account is connected to OneUptime.** OneUptime could not save the message as a note just now. Please try again.",
      "Your Slack account is connected to OneUptime. OneUptime could not save the message as a note just now",
    ],
  ])(
    "%s: answered, never done",
    async (
      _case: string,
      saved: WorkspaceMessageNoteResult,
      markdown: string,
      text: string,
    ) => {
      slackSave.mockResolvedValue(saved);

      const result: WorkspaceConnectCompletionResult =
        await WorkspaceConnectCompletion.complete({
          request: notePress(),
          userId: USER_ID,
        });

      expect(result).toEqual({
        outcome: ConnectRequestOutcome.Answered,
        answer: { markdown: markdown, text: text },
      });
    },
  );

  /*
   * Microsoft Teams saves a message by the reaction on it: when neither is
   * there any more, the message may still be - only the reaction is gone.
   */
  test("in Microsoft Teams, a message not found is the message or the reaction gone", async () => {
    teamsSave.mockResolvedValue({
      outcome: WorkspaceMessageNoteOutcome.NotFound,
    });

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request({
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceUserId: "aad-jane",
          purpose:
            "save the message you reacted to as a private note on this incident",
          pendingAction: {
            kind: WorkspacePendingActionKind.SavePrivateNote,
            eventType: WorkspaceEventType.Incident,
            eventId: INCIDENT_ID,
            message: {
              channelId: "19:inc-2@thread.tacv2",
              messageId: "1760000000200",
              teamId: "graph-team-ops",
            },
          },
          slack: undefined,
        }),
        userId: USER_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Answered,
      answer: {
        markdown:
          "✅ **Your Microsoft Teams account is connected to OneUptime.** The message, or your reaction to it, is no longer there, so nothing was saved.",
        text: "Your Microsoft Teams account is connected to OneUptime. The message, or your reaction to it, is no longer there, so nothing was saved",
      },
    });
  });

  test("a save that throws is logged, and answered as a failure: the account is connected either way", async () => {
    slackSave.mockRejectedValue(new Error("database is down"));
    const errorLog: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {}) as never);

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: notePress(),
        userId: USER_ID,
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
    expect(result.answer.text).toBe(
      "Your Slack account is connected to OneUptime. OneUptime could not save the message as a note just now",
    );
    expect(errorLog).toHaveBeenCalledWith(
      "Could not save a pinned message once its chat account was connected.",
      { projectId: PROJECT_ID.toString() },
    );
  });

  test("Slack not set up for the project any more: nothing is read, and it says so", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: notePress(),
        userId: USER_ID,
      });

    expect(slackSave).not.toHaveBeenCalled();
    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
  });

  test("a record that cannot be named is 'the incident'", async () => {
    jest
      .spyOn(WorkspaceReactionNote, "getResourceDisplay")
      .mockRejectedValue(new Error("gone"));

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: notePress(),
        userId: USER_ID,
      });

    expect(result.answer.markdown).toBe(
      "✅ **Your Slack account is connected to OneUptime.** You saved the message as a private note on the incident.",
    );
  });

  test("an alert episode's pin saves on the episode", async () => {
    await WorkspaceConnectCompletion.complete({
      request: notePress({
        pendingAction: {
          kind: WorkspacePendingActionKind.SavePrivateNote,
          eventType: WorkspaceEventType.AlertEpisode,
          eventId: INCIDENT_ID,
          message: MESSAGE,
        },
      }),
      userId: USER_ID,
    });

    expect(slackSave.mock.calls[0]![0].resource.resourceType).toBe(
      WorkspaceNoteResourceType.AlertEpisode,
    );
  });
});
