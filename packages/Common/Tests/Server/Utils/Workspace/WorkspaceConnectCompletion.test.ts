import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import logger from "../../../../Server/Utils/Logger";
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
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
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
    expect(already).toHaveBeenCalledWith({
      event: incident(),
      press: "Acknowledge",
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
      new BadDataException(
        "Could not acknowledge this incident: the incident was not found in this project, or you do not have access to it.",
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
