import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import User from "../../../../../Models/DatabaseModels/User";
import UserMattermost from "../../../../../Models/DatabaseModels/UserMattermost";
import UserMicrosoftTeams from "../../../../../Models/DatabaseModels/UserMicrosoftTeams";
import UserNotificationSetting from "../../../../../Models/DatabaseModels/UserNotificationSetting";
import UserSlack from "../../../../../Models/DatabaseModels/UserSlack";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import ProjectCallSMSConfigService from "../../../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import UserEmailService from "../../../../../Server/Services/UserEmailService";
import UserMattermostService from "../../../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationSettingService from "../../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../../Server/Services/UserService";
import UserSlackService from "../../../../../Server/Services/UserSlackService";
import WorkspaceUserNotificationService, {
  WorkspaceSentDirectMessage,
} from "../../../../../Server/Services/WorkspaceUserNotificationService";
import logger from "../../../../../Server/Utils/Logger";
import PublicNoteApprovalEngine, {
  PublicNoteKind,
} from "../../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications, {
  PublicNoteApprovalChatAsk,
  PublicNoteApprovalMessageFacts,
} from "../../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import WorkspacePublicNoteApproval, {
  PublicNoteApprovalButtonValue,
  WorkspaceDirectMessage,
} from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApproval";
import WorkspacePublicNoteApprovalMessages from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalMessages";
import { CallRequestMessage } from "../../../../../Types/Call/CallRequest";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { EmailEnvelope } from "../../../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../../Types/ObjectID";
import PushNotificationMessage from "../../../../../Types/PushNotification/PushNotificationMessage";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  CAROL,
  INCIDENT_ID,
  LEGAL,
  NAMES,
  NOTE_ID,
  NOTE_TEXT,
  PROJECT_ID,
  SUBMITTED_AT,
  SUPPORT,
  host,
  memberProps,
  restoreWorld,
  startWorld,
  world,
  buttonValue,
} from "./PublicNoteApprovalChatWorld";
import WorkspacePublicNoteApprovalActions from "../../../../../Server/Utils/Workspace/WorkspacePublicNoteApprovalActions";

/*
 * ASKING APPROVERS IN CHAT, WITH APPROVE AND REJECT (#6289).
 *
 *  - Only the chat accounts of someone who chose chat for public note
 *    approval get it - each chat they turned on, and none they did not -
 *    and it is the event's own message, with its buttons and its
 *    notification line, not the one made from the email's subject.
 *  - askApprovers builds that message once for the step - nothing in it is
 *    anybody's own - with Approve and Reject carrying the note, the round,
 *    the step, whether approving it publishes it, and a digest of the text
 *    it shows; a step with nothing to name asks in chat as before.
 *  - The engine hands it what it asks about: the step the note now waits
 *    for, when it is sent and when a step is approved.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const BOB_ID: string = "b2b2b2b2-0000-4000-8000-000000000002";

function facts(
  overrides: Partial<PublicNoteApprovalMessageFacts> = {},
): PublicNoteApprovalMessageFacts {
  return {
    projectId: PROJECT_ID,
    recordLabel: "Incident INC-42",
    recordTitle: "Checkout is down",
    notesUrl: "https://oneuptime.example/dashboard/p/incidents/i/public-notes",
    note: NOTE_TEXT,
    isEdit: false,
    incidentId: INCIDENT_ID,
    ...overrides,
  };
}

function chat(
  overrides: Partial<PublicNoteApprovalChatAsk> = {},
): PublicNoteApprovalChatAsk {
  return {
    kind: PublicNoteKind.Incident,
    noteId: NOTE_ID,
    recordId: INCIDENT_ID,
    submittedAt: SUBMITTED_AT,
    stepId: SUPPORT.id,
    isFinal: false,
    waitingFor: {
      position: {
        step: SUPPORT,
        number: 1,
        count: 2,
        isFinal: false,
        isAskedAgain: false,
      },
      approverNames: ["Bob", "Dave"],
    },
    ...overrides,
  };
}

function askMessage(): WorkspaceDirectMessage {
  return PublicNoteApprovalNotifications.getChatMessage({
    facts: facts(),
    chat: chat(),
    sentBy: "Alice",
  })!;
}

describe("UserNotificationSettingService.sendUserNotification - an event's own chat message", () => {
  let sendDm: AnySpy;
  let findSlacks: AnySpy;

  function settings(
    overrides: Partial<UserNotificationSetting>,
  ): UserNotificationSetting {
    return {
      alertByEmail: false,
      alertBySMS: false,
      alertByCall: false,
      alertByPush: false,
      alertByWhatsApp: false,
      alertByTelegram: false,
      alertBySlack: false,
      alertByMicrosoftTeams: false,
      alertByMattermost: false,
      alertByWebhook: false,
      alertByCustomChannel: false,
      ...overrides,
    } as unknown as UserNotificationSetting;
  }

  async function send(
    message: WorkspaceDirectMessage | undefined,
  ): Promise<void> {
    await UserNotificationSettingService.sendUserNotification({
      userId: USER_ID,
      projectId: PROJECT_ID,
      eventType:
        NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
      emailEnvelope: {
        subject:
          "Approval needed: public note on Incident INC-42 - Checkout is down",
        vars: {},
      } as unknown as EmailEnvelope,
      smsMessage: { message: "Approval needed: a public note waits for you." },
      callRequestMessage: {} as CallRequestMessage,
      pushNotificationMessage: {} as PushNotificationMessage,
      incidentId: INCIDENT_ID,
      ...(message ? { workspaceMessage: message } : {}),
    });

    /*
     * The chat sends are fire-and-forget, but each is started before
     * sendUserNotification resolves: nothing to wait for.
     */
  }

  function sentTo(): Array<string> {
    return sendDm.mock.calls.map((call: Array<any>): string => {
      return (call[0] as { workspaceType: WorkspaceType }).workspaceType;
    });
  }

  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);
    jest.spyOn(UserEmailService, "findBy").mockResolvedValue([] as never);
    findSlacks = jest
      .spyOn(UserSlackService, "findBy")
      .mockResolvedValue([
        { slackUserId: "U0BOB" } as unknown as UserSlack,
      ] as never) as AnySpy;
    jest
      .spyOn(UserMicrosoftTeamsService, "findBy")
      .mockResolvedValue([
        { microsoftTeamsUserId: "entra-bob" } as unknown as UserMicrosoftTeams,
      ] as never);
    jest
      .spyOn(UserMattermostService, "findBy")
      .mockResolvedValue([
        { mattermostUserId: "m".repeat(26) } as unknown as UserMattermost,
      ] as never);
    sendDm = jest
      .spyOn(WorkspaceUserNotificationService, "sendDirectMessageToUser")
      .mockResolvedValue(undefined as never) as AnySpy;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every chat a person turned on gets the message with Approve and Reject, and its notification line", async () => {
    jest.spyOn(UserNotificationSettingService, "findOneBy").mockResolvedValue(
      settings({
        alertBySlack: true,
        alertByMicrosoftTeams: true,
        alertByMattermost: true,
      }) as never,
    );
    const message: WorkspaceDirectMessage = askMessage();

    await send(message);

    expect(sentTo()).toEqual([
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
      WorkspaceType.Mattermost,
    ]);

    for (const call of sendDm.mock.calls) {
      const sent: {
        messageBlocks: Array<WorkspaceMessageBlock>;
        notificationText?: string;
        workspaceUserId: string;
      } = call[0] as never;

      expect(sent.messageBlocks).toBe(message.messageBlocks);
      expect(sent.notificationText).toBe(
        "Approval needed: public note on Incident INC-42 - Checkout is down",
      );

      const buttons: WorkspacePayloadButtons = sent.messageBlocks[
        sent.messageBlocks.length - 1
      ] as WorkspacePayloadButtons;

      expect(
        buttons.buttons.map((button: WorkspaceMessagePayloadButton): string => {
          return button.actionId;
        }),
      ).toEqual([
        SlackActionType.ApprovePublicNote,
        SlackActionType.ViewRejectPublicNote,
        SlackActionType.OpenInOneUptime,
      ]);
    }
  });

  test("each chat's send is told where its copy landed, to keep it (#6317)", async () => {
    jest.spyOn(UserNotificationSettingService, "findOneBy").mockResolvedValue(
      settings({
        alertBySlack: true,
        alertByMicrosoftTeams: true,
        alertByMattermost: true,
      }) as never,
    );
    const onSent: AnySpy = jest.fn(async (): Promise<void> => {
      return undefined;
    }) as AnySpy;

    await send({ ...askMessage(), onSent: onSent as never });

    expect(sendDm).toHaveBeenCalledTimes(3);

    for (const call of sendDm.mock.calls) {
      expect((call[0] as { onSent?: unknown }).onSent).toBe(onSent);
    }
  });

  test("a message made from the subject and the SMS keeps nothing: there is no copy of the event's own to replace", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settings({ alertBySlack: true }) as never);
    const onSent: AnySpy = jest.fn() as AnySpy;

    await send({
      messageBlocks: [],
      notificationText: "Approval needed",
      onSent: onSent as never,
    });

    expect(sendDm).toHaveBeenCalledTimes(1);
    expect((sendDm.mock.calls[0]![0] as { onSent?: unknown }).onSent).toBe(
      undefined,
    );
  });

  test("only the chats a person chose: Mattermost alone, and no other", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settings({ alertByMattermost: true }) as never);

    await send(askMessage());

    expect(sentTo()).toEqual([WorkspaceType.Mattermost]);
    expect(findSlacks).not.toHaveBeenCalled();
  });

  test("somebody who did not choose chat for it gets no direct message at all", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settings({ alertByEmail: false }) as never);

    await send(askMessage());

    expect(sendDm).not.toHaveBeenCalled();
    expect(findSlacks).not.toHaveBeenCalled();
  });

  test("somebody with no setting for the event - not a member any more - gets nothing", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(null as never);

    await send(askMessage());

    expect(sendDm).not.toHaveBeenCalled();
  });

  test("an event with no message of its own is made from the subject and the SMS, as before", async () => {
    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settings({ alertBySlack: true }) as never);

    await send(undefined);

    const sent: { messageBlocks: Array<WorkspacePayloadMarkdown> } = sendDm.mock
      .calls[0]![0] as never;

    expect(sent.messageBlocks).toHaveLength(1);
    expect(sent.messageBlocks[0]!.text).toBe(
      "🔔 **Approval needed: public note on Incident INC-42 - Checkout is down**\n\nApproval needed: a public note waits for you.",
    );
    expect(
      (sendDm.mock.calls[0]![0] as { notificationText?: string })
        .notificationText,
    ).toBeUndefined();
  });
});

describe("PublicNoteApprovalNotifications.askApprovers - the chat message", () => {
  let sent: Array<{ userId: string; data: any }>;

  beforeEach(() => {
    sent = [];

    jest
      .spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      )
      .mockImplementation((async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }): Promise<DatabaseCommonInteractionProps> => {
        return {
          userId: data.userId,
          tenantId: data.projectId,
          userTenantAccessPermission: {
            [data.projectId.toString()]: {},
          } as never,
        } as DatabaseCommonInteractionProps;
      }) as never);
    jest
      .spyOn(
        UserNotificationSettingService,
        "addPublicNoteApprovalNotificationSettings",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: any): Promise<void> => {
        sent.push({ userId: data.userId.toString(), data });
      }) as never);
    jest.spyOn(UserService, "findBy").mockImplementation((async () => {
      const alice: User = new User();
      alice._id = "a1a1a1a1-0000-4000-8000-000000000001";
      alice.name = "Alice" as never;
      return [alice];
    }) as never);
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ name: "Acme" } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function ask(
    chatAsk: PublicNoteApprovalChatAsk | undefined,
    noteFacts: PublicNoteApprovalMessageFacts = facts(),
  ): Promise<void> {
    await PublicNoteApprovalNotifications.askApprovers({
      facts: noteFacts,
      userIds: [BOB_ID, CAROL],
      namedUserIds: [BOB_ID],
      sentByUserId: "a1a1a1a1-0000-4000-8000-000000000001",
      stepLabel: "Step 1 of 2 (Support)",
      canRead: async (): Promise<boolean> => {
        return true;
      },
      ...(chatAsk ? { chat: chatAsk } : {}),
    });
  }

  test("each approver's notification carries the one chat message, whose buttons name the note, its round, step and text", async () => {
    await ask(chat());

    expect(sent).toHaveLength(2);

    const message: WorkspaceDirectMessage = sent[0]!.data.workspaceMessage;

    // The same message for both: only who keeps where it landed is their own.
    expect(sent[1]!.data.workspaceMessage.messageBlocks).toBe(
      message.messageBlocks,
    );
    expect(sent[1]!.data.workspaceMessage.notificationText).toBe(
      message.notificationText,
    );
    expect(message.notificationText).toBe(
      "Approval needed: public note on Incident INC-42 - Checkout is down",
    );
    expect(
      (message.messageBlocks[0] as WorkspacePayloadMarkdown).text,
    ).toContain(
      "**Alice** sent it for approval. It waits for step 1 of 2 (Support): Bob, Dave.",
    );

    const buttons: WorkspacePayloadButtons = message.messageBlocks[
      message.messageBlocks.length - 1
    ] as WorkspacePayloadButtons;

    expect(
      WorkspacePublicNoteApproval.readValue(buttons.buttons[0]!.value),
    ).toEqual({
      kind: PublicNoteKind.Incident,
      projectId: PROJECT_ID,
      recordId: INCIDENT_ID,
      noteId: NOTE_ID,
      submittedAt: SUBMITTED_AT,
      stepId: SUPPORT.id,
      isFinal: false,
      isEdit: false,
      textDigest: WorkspacePublicNoteApproval.getTextDigest(NOTE_TEXT),
    });
  });

  /*
   * Each copy is kept as it is sent (#6317): who it was sent to, and what
   * its buttons carry - so it can be replaced once the note is decided.
   */
  test("each approver's copy is kept as it lands: for them, with what its buttons carry", async () => {
    const keep: AnySpy = jest
      .spyOn(WorkspacePublicNoteApprovalMessages, "keep")
      .mockResolvedValue(undefined as never) as AnySpy;

    await ask(chat());

    const landed: WorkspaceSentDirectMessage = {
      workspaceType: WorkspaceType.Slack,
      workspaceProjectId: "T0TEAM",
      channelId: "D0BOB",
      messageId: "1760000000.000001",
    };

    for (const each of sent) {
      await (each.data.workspaceMessage as WorkspaceDirectMessage).onSent!(
        landed,
      );
    }

    expect(keep).toHaveBeenCalledTimes(2);
    expect(
      keep.mock.calls.map((call: Array<any>): string => {
        return (call[0] as { userId: ObjectID }).userId.toString();
      }),
    ).toEqual([BOB_ID, CAROL]);

    for (const call of keep.mock.calls) {
      const kept: {
        value: PublicNoteApprovalButtonValue;
        sent: WorkspaceSentDirectMessage;
      } = call[0] as never;

      expect(kept.sent).toBe(landed);
      expect(kept.value).toEqual({
        kind: PublicNoteKind.Incident,
        projectId: PROJECT_ID,
        recordId: INCIDENT_ID,
        noteId: NOTE_ID,
        submittedAt: SUBMITTED_AT,
        stepId: SUPPORT.id,
        isFinal: false,
        isEdit: false,
        textDigest: WorkspacePublicNoteApproval.getTextDigest(NOTE_TEXT),
      });
    }
  });

  test("a step asked with no buttons keeps nothing: there is nothing to replace", async () => {
    await ask(undefined);

    for (const each of sent) {
      expect(each.data.workspaceMessage).toBeUndefined();
    }
  });

  test("an edit's message says so, and its buttons say it is an edit", async () => {
    await ask(
      chat({ isFinal: true }),
      facts({ isEdit: true, note: "The edit." }),
    );

    const message: WorkspaceDirectMessage = sent[0]!.data.workspaceMessage;
    const buttons: WorkspacePayloadButtons = message.messageBlocks[
      message.messageBlocks.length - 1
    ] as WorkspacePayloadButtons;

    expect(buttons.buttons[0]!.title).toBe("Approve and publish");
    expect(
      WorkspacePublicNoteApproval.readValue(buttons.buttons[0]!.value),
    ).toMatchObject({
      isEdit: true,
      isFinal: true,
      textDigest: WorkspacePublicNoteApproval.getTextDigest("The edit."),
    });
  });

  test("without what the buttons need, approvers are asked in chat as every event asks", async () => {
    await ask(undefined);

    expect(sent).toHaveLength(2);
    expect(sent[0]!.data.workspaceMessage).toBeUndefined();
    // Email and push, as before.
    expect(sent[0]!.data.emailEnvelope.subject).toBe(
      "Approval needed: public note on Incident INC-42 - Checkout is down",
    );
  });

  test("a message that cannot be built leaves the buttons off, and still asks everybody", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(WorkspacePublicNoteApproval, "getAskMessage")
      .mockImplementation((): never => {
        throw new Error("could not build");
      });

    await ask(chat());

    expect(sent).toHaveLength(2);
    expect(sent[0]!.data.workspaceMessage).toBeUndefined();
  });
});

describe("the engine asks with what the message's buttons need", () => {
  beforeEach(() => {
    startWorld();
  });

  afterEach(async () => {
    await restoreWorld();
  });

  test("a step approved: the next step is asked, its round, its step, and that approving it publishes the note", async () => {
    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(BOB_ID),
    });

    expect(world.asked).toEqual([[CAROL]]);
    expect(world.askedChat).toEqual([
      {
        kind: PublicNoteKind.Incident,
        noteId: NOTE_ID,
        recordId: INCIDENT_ID,
        submittedAt: SUBMITTED_AT,
        stepId: LEGAL.id,
        isFinal: true,
        waitingFor: {
          position: {
            step: LEGAL,
            number: 2,
            count: 2,
            isFinal: true,
            isAskedAgain: false,
          },
          approverNames: ["Carol"],
        },
      },
    ]);
  });

  test("a step whose names cannot be read for the buttons is still asked, with no buttons", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    let calls: number = 0;

    jest
      .spyOn(PublicNoteApprovalNotifications, "getUserNames")
      .mockImplementation((async (ids: ReadonlyArray<string>) => {
        calls++;

        // The second read is the chat message's: the feed's came first.
        if (calls === 2) {
          throw new Error("names unavailable");
        }

        const found: Record<string, string> = {};

        for (const id of ids) {
          if (NAMES[id]) {
            found[id] = NAMES[id]!;
          }
        }

        return found;
      }) as never);

    await WorkspacePublicNoteApprovalActions.approve({
      value: buttonValue(),
      props: memberProps(BOB_ID),
    });

    expect(world.asked).toEqual([[CAROL]]);
    expect(world.askedChat).toEqual([undefined]);
  });

  test("a note sent for approval: its first step is asked, about this round", async () => {
    await PublicNoteApprovalEngine.afterCreate({
      host: host(),
      note: { ...world.stored, id: NOTE_ID } as never,
    });

    expect(world.askedChat).toHaveLength(1);
    expect(world.askedChat[0]).toMatchObject({
      noteId: NOTE_ID,
      recordId: INCIDENT_ID,
      submittedAt: SUBMITTED_AT,
      stepId: SUPPORT.id,
      isFinal: false,
    });
  });
});
