import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import IncidentEpisodePublicNoteService from "../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import PublicNoteApprovalEngine, {
  PublicNoteApprovalHost,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications, {
  buildApprovalDecidedMessage,
  buildApprovalRequestedMessage,
  PublicNoteApprovalMessage,
  PublicNoteApprovalMessageFacts,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Who is told about a public note's approval, and what they are told
 * (issue #5720): an approver that a note waits for them, its sender how it
 * was decided. Only members of the project who can read the note are told:
 * a notification is the note in another place.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002";
const CAROL: string = "c3c3c3c3-0000-4000-8000-000000000003";

function facts(
  overrides: Partial<PublicNoteApprovalMessageFacts> = {},
): PublicNoteApprovalMessageFacts {
  return {
    projectId: PROJECT_ID,
    recordLabel: "Incident INC-42",
    recordTitle: "Checkout is down",
    notesUrl: "https://oneuptime.example/dashboard/p/incidents/i/public-notes",
    note: "We are **looking** into it.",
    isEdit: false,
    incidentId: INCIDENT_ID,
    ...overrides,
  };
}

describe("buildApprovalRequestedMessage", () => {
  test("asks for approval, says the note is held until then, and links to where it is decided", () => {
    const message: PublicNoteApprovalMessage = buildApprovalRequestedMessage({
      facts: facts(),
      projectName: "Acme",
      sentBy: "Alice",
      stepLabel: "Step 1 of 2: Support",
      isTeam: false,
    });

    expect(message.eventType).toBe(
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
    );
    expect(message.templateType).toBe(
      EmailTemplateType.PublicNoteApprovalRequested,
    );
    expect(message.subject).toBe(
      "Approval needed: public note on Incident INC-42 - Checkout is down",
    );
    expect(message.emailVars["leadSentence"]).toBe(
      "A public note on Incident INC-42 is waiting for your approval. It is not on status pages and no subscriber is told about it until it is approved.",
    );
    expect(message.emailVars["sentBy"]).toBe("Alice");
    expect(message.emailVars["stepLabel"]).toBe("Step 1 of 2: Support");
    expect(message.emailVars["projectName"]).toBe("Acme");
    expect(message.emailVars["notesViewLink"]).toBe(facts().notesUrl);
    expect(message.emailVars["reasonSentence"]).toContain(
      "You approve public notes for this step.",
    );
    expect(message.pushType).toBe("public-note-approval-requested");
    expect(message.smsText).toContain("Approval needed");
    expect(message.callText).toBe(
      "This is a message from OneUptime. A public note on Incident INC-42, Checkout is down, is waiting for your approval. To approve or reject it, go to the OneUptime Dashboard. To change these calls go to User Settings in the OneUptime Dashboard. Good bye.",
    );
  });

  test("an edit, asked of a team's member, says so", () => {
    const message: PublicNoteApprovalMessage = buildApprovalRequestedMessage({
      facts: facts({ isEdit: true }),
      projectName: "Acme",
      sentBy: "Alice",
      stepLabel: "Approval",
      isTeam: true,
    });

    expect(message.emailVars["leadSentence"]).toMatch(
      /^An edit of a public note on Incident INC-42 is waiting/,
    );
    expect(message.emailVars["reasonSentence"]).toContain(
      "You are on a team that approves public notes for this step.",
    );
    expect(message.smsText).toContain("an edit of a public note");
  });
});

describe("buildApprovalDecidedMessage", () => {
  test("approved: published now, by whom", () => {
    const message: PublicNoteApprovalMessage = buildApprovalDecidedMessage({
      facts: facts(),
      projectName: "Acme",
      decidedBy: "Bob",
      isApproved: true,
      reason: "ignored when approved",
    });

    expect(message.eventType).toBe(
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION,
    );
    expect(message.templateType).toBe(
      EmailTemplateType.PublicNoteApprovalDecided,
    );
    expect(message.subject).toBe(
      "Approved: public note on Incident INC-42 - Checkout is down",
    );
    expect(message.emailVars["leadSentence"]).toBe(
      "Your public note on Incident INC-42 was approved by Bob and is now published on status pages.",
    );
    expect(message.emailVars["decision"]).toBe("Approved");
    expect(message.emailVars["reason"]).toBe("");
    expect(message.callText).toBe(
      "This is a message from OneUptime. Your public note on Incident INC-42 was approved and is published. Good bye.",
    );
    expect(message.pushBody).toBe("Approved by Bob. It is now published.");
    expect(message.pushType).toBe("public-note-approval-approved");
  });

  test("an edit approved: status pages show the edited note", () => {
    expect(
      buildApprovalDecidedMessage({
        facts: facts({ isEdit: true }),
        projectName: "Acme",
        decidedBy: "Bob",
        isApproved: true,
      }).emailVars["leadSentence"],
    ).toBe(
      "Your edit of a public note on Incident INC-42 was approved by Bob. Status pages now show the edited note.",
    );
  });

  test("rejected: not published, the reason, and how to send it again", () => {
    const message: PublicNoteApprovalMessage = buildApprovalDecidedMessage({
      facts: facts(),
      projectName: "Acme",
      decidedBy: "Bob",
      isApproved: false,
      reason: "Do not name the vendor.",
    });

    expect(message.subject).toBe(
      "Rejected: public note on Incident INC-42 - Checkout is down",
    );
    expect(message.emailVars["leadSentence"]).toBe(
      "Your public note on Incident INC-42 was rejected by Bob. It is not published. Change it and send it again from the Dashboard.",
    );
    expect(message.emailVars["decision"]).toBe("Rejected");
    expect(message.emailVars["reason"]).toBe("Do not name the vendor.");
    expect(message.smsText).toContain("Reason: Do not name the vendor.");
    expect(message.pushBody).toBe("Rejected by Bob. Do not name the vendor.");
    expect(message.pushType).toBe("public-note-approval-rejected");
    // A call does not read a reason out; it says where to see it.
    expect(message.callText).toBe(
      "This is a message from OneUptime. Your public note on Incident INC-42 was rejected. To see why, go to the OneUptime Dashboard. Good bye.",
    );
    expect(message.callText).not.toContain("vendor");
  });
});

/*
 * A record's label names its kind - "Incident INC-42", "Episode EP-7",
 * "Scheduled Maintenance SM-3" - so every message names the record by its
 * label alone (#7906): a kind before the label, as in "a public note on
 * incident Incident INC-42", names the kind twice. Each kind's facts are
 * made as the server makes them: its own note service's approval host
 * reads the record, and the engine's getFacts hands on what it read.
 */
describe("each kind of record, named in its messages", () => {
  const RECORD_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  type GetFacts = (
    host: PublicNoteApprovalHost<BaseModel>,
    note: Record<string, unknown>,
    isEdit: boolean,
  ) => Promise<PublicNoteApprovalMessageFacts | null>;

  interface RecordKind {
    name: string;
    host: () => PublicNoteApprovalHost<BaseModel>;
    // The label its note service writes.
    label: string;
    /*
     * The last word of each name the kind goes by ("incident episode",
     * "maintenance event", "scheduled maintenance"): one of them right
     * before the label names the kind twice.
     */
    kindWords: Array<string>;
  }

  const KINDS: Array<RecordKind> = [
    {
      name: "incident",
      host: (): PublicNoteApprovalHost<BaseModel> => {
        return IncidentPublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      },
      label: "Incident INC-42",
      kindWords: ["incident"],
    },
    {
      name: "episode",
      host: (): PublicNoteApprovalHost<BaseModel> => {
        return IncidentEpisodePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      },
      label: "Episode EP-7",
      kindWords: ["episode"],
    },
    {
      name: "maintenance event",
      host: (): PublicNoteApprovalHost<BaseModel> => {
        return ScheduledMaintenancePublicNoteService.getApprovalHost() as unknown as PublicNoteApprovalHost<BaseModel>;
      },
      label: "Scheduled Maintenance SM-3",
      kindWords: ["maintenance", "event"],
    },
  ];

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      title: "Checkout is down",
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
    } as never);
    jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue({
      title: "Checkout is down",
      episodeNumber: 7,
      episodeNumberWithPrefix: "EP-7",
    } as never);
    jest.spyOn(ScheduledMaintenanceService, "findOneById").mockResolvedValue({
      title: "Database upgrade",
      scheduledMaintenanceNumber: 3,
      scheduledMaintenanceNumberWithPrefix: "SM-3",
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Every text of a message a person reads or hears.
  const textsOf: (message: PublicNoteApprovalMessage) => Array<string> = (
    message: PublicNoteApprovalMessage,
  ): Array<string> => {
    return [
      message.subject,
      ...Object.values(message.emailVars),
      message.smsText,
      message.callText,
      message.pushTitle,
      message.pushBody,
    ];
  };

  test.each(KINDS)(
    "$name: by its label, never by its kind and then its label",
    async (kind: RecordKind) => {
      const getFacts: GetFacts = (
        PublicNoteApprovalEngine as unknown as { getFacts: GetFacts }
      ).getFacts.bind(PublicNoteApprovalEngine);
      const host: PublicNoteApprovalHost<BaseModel> = kind.host();

      for (const isEdit of [false, true]) {
        const facts: PublicNoteApprovalMessageFacts | null = await getFacts(
          host,
          {
            projectId: PROJECT_ID,
            [host.parentIdColumn]: RECORD_ID,
            note: "We are looking into it.",
            pendingNote: "A fix is going out.",
          },
          isEdit,
        );

        if (!facts) {
          throw new Error(`No facts for a note on the ${kind.name}.`);
        }

        expect(facts.recordLabel).toBe(kind.label);

        const messages: Array<PublicNoteApprovalMessage> = [
          buildApprovalRequestedMessage({
            facts,
            projectName: "Acme",
            sentBy: "Alice",
            stepLabel: "Approval",
            isTeam: false,
          }),
          buildApprovalDecidedMessage({
            facts,
            projectName: "Acme",
            decidedBy: "Bob",
            isApproved: true,
          }),
          buildApprovalDecidedMessage({
            facts,
            projectName: "Acme",
            decidedBy: "Bob",
            isApproved: false,
            reason: "Do not name the vendor.",
          }),
        ];

        for (const message of messages) {
          // No text names the kind right before the label.
          expect(
            textsOf(message).filter((text: string): boolean => {
              return kind.kindWords.some((word: string): boolean => {
                return text
                  .toLowerCase()
                  .includes(`${word} ${kind.label.toLowerCase()}`);
              });
            }),
          ).toEqual([]);

          // The email and the call say where the note is: on the label.
          expect(message.emailVars["leadSentence"]).toContain(
            ` on ${kind.label} `,
          );
          expect(message.callText).toContain(` on ${kind.label}`);
        }
      }
    },
  );
});

describe("PublicNoteApprovalNotifications: who is told", () => {
  // The people who are members of the project, by id.
  let members: Set<string>;
  let sent: Array<{ userId: string; eventType: string; data: any }>;
  let settingsAdded: Array<string>;

  beforeEach(() => {
    members = new Set([ALICE, BOB, CAROL]);
    sent = [];
    settingsAdded = [];

    jest
      .spyOn(
        AccessTokenService,
        "getDatabaseCommonInteractionPropsByUserAndProject",
      )
      .mockImplementation((async (data: {
        userId: ObjectID;
        projectId: ObjectID;
      }): Promise<DatabaseCommonInteractionProps> => {
        const isMember: boolean = members.has(data.userId.toString());

        return {
          userId: data.userId,
          tenantId: data.projectId,
          userTenantAccessPermission: isMember
            ? ({ [data.projectId.toString()]: {} } as never)
            : {},
        } as DatabaseCommonInteractionProps;
      }) as never);

    jest
      .spyOn(
        UserNotificationSettingService,
        "addPublicNoteApprovalNotificationSettings",
      )
      .mockImplementation((async (userId: ObjectID): Promise<void> => {
        settingsAdded.push(userId.toString());
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: any): Promise<void> => {
        sent.push({
          userId: data.userId.toString(),
          eventType: data.eventType,
          data,
        });
      }) as never);

    jest.spyOn(UserService, "findBy").mockImplementation((async (
      query: any,
    ) => {
      const users: Array<User> = [];

      for (const [id, name] of [
        [ALICE, "Alice"],
        [BOB, "Bob"],
        [CAROL, ""],
      ] as Array<[string, string]>) {
        const user: User = new User();
        user._id = id;
        if (name) {
          user.name = name as never;
        }
        user.email = `${id.slice(0, 4)}@example.com` as never;
        users.push(user);
      }

      void query;
      return users;
    }) as never);

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      name: "Acme",
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const canReadAll: (
    props: DatabaseCommonInteractionProps,
  ) => Promise<boolean> = async (): Promise<boolean> => {
    return true;
  };

  test("asks each approver who is a member and can read the note, and returns them", async () => {
    const asked: Array<ObjectID> =
      await PublicNoteApprovalNotifications.askApprovers({
        facts: facts(),
        userIds: [BOB, CAROL],
        namedUserIds: [BOB],
        sentByUserId: ALICE,
        stepLabel: "Approval",
        canRead: canReadAll,
      });

    expect(
      asked.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BOB, CAROL]);
    expect(
      sent.map((message: { userId: string; eventType: string }) => {
        return [message.userId, message.eventType];
      }),
    ).toEqual([
      [
        BOB,
        NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
      ],
      [
        CAROL,
        NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
      ],
    ]);
    // The settings every member gets, made before they are first told.
    expect(settingsAdded).toEqual([BOB, CAROL]);

    // Named on the step, or on it through a team.
    expect(sent[0]!.data.emailEnvelope.vars.reasonSentence).toContain(
      "You approve public notes",
    );
    expect(sent[1]!.data.emailEnvelope.vars.reasonSentence).toContain(
      "You are on a team",
    );
    // Who sent it, by name; the project; the record the webhook names.
    expect(sent[0]!.data.emailEnvelope.vars.sentBy).toBe("Alice");
    expect(sent[0]!.data.emailEnvelope.vars.projectName).toBe("Acme");
    expect(sent[0]!.data.incidentId).toEqual(INCIDENT_ID);
    // The note, as the email shows it.
    expect(sent[0]!.data.emailEnvelope.vars.note).toContain(
      "<strong>looking</strong>",
    );
    expect(sent[0]!.data.emailEnvelope.isSubjectLiteral).toBe(true);
    // A request waits for them: the push stays until they act on it.
    expect(sent[0]!.data.pushNotificationMessage.requireInteraction).toBe(true);
  });

  test("skips who has left the project, or cannot read the note", async () => {
    members.delete(CAROL);

    const asked: Array<ObjectID> =
      await PublicNoteApprovalNotifications.askApprovers({
        facts: facts(),
        userIds: [ALICE, BOB, CAROL],
        namedUserIds: [ALICE, BOB, CAROL],
        stepLabel: "Approval",
        canRead: async (
          props: DatabaseCommonInteractionProps,
        ): Promise<boolean> => {
          return props.userId?.toString() !== ALICE;
        },
      });

    expect(
      asked.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([BOB]);
    expect(settingsAdded).toEqual([BOB]);
  });

  test("a read that fails tells nobody it could not check", async () => {
    const asked: Array<ObjectID> =
      await PublicNoteApprovalNotifications.askApprovers({
        facts: facts(),
        userIds: [BOB],
        namedUserIds: [BOB],
        stepLabel: "Approval",
        canRead: async (): Promise<boolean> => {
          throw new Error("db down");
        },
      });

    expect(asked).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("one person who cannot be told does not stop the rest", async () => {
    (
      UserNotificationSettingService.sendUserNotification as unknown as jest.Mock
    ).mockImplementation((async (data: any): Promise<void> => {
      if (data.userId.toString() === BOB) {
        throw new Error("mail down");
      }

      sent.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
        data,
      });
    }) as never);

    const asked: Array<ObjectID> =
      await PublicNoteApprovalNotifications.askApprovers({
        facts: facts(),
        userIds: [BOB, CAROL],
        namedUserIds: [BOB, CAROL],
        stepLabel: "Approval",
        canRead: canReadAll,
      });

    expect(
      asked.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CAROL]);
  });

  test("nobody to ask reads nothing", async () => {
    expect(
      await PublicNoteApprovalNotifications.askApprovers({
        facts: facts(),
        userIds: [],
        namedUserIds: [],
        stepLabel: "Approval",
        canRead: canReadAll,
      }),
    ).toEqual([]);
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
    expect(UserService.findBy).not.toHaveBeenCalled();
  });

  test("a note OneUptime sent with nobody behind it says so", async () => {
    await PublicNoteApprovalNotifications.askApprovers({
      facts: facts(),
      userIds: [BOB],
      namedUserIds: [BOB],
      stepLabel: "Approval",
      canRead: canReadAll,
    });

    expect(sent[0]!.data.emailEnvelope.vars.sentBy).toBe("OneUptime");
  });

  test("tells the sender how their note was decided, naming who decided", async () => {
    expect(
      await PublicNoteApprovalNotifications.tellSender({
        facts: facts(),
        sentByUserId: ALICE,
        decidedByUserId: BOB,
        isApproved: false,
        reason: "Do not name the vendor.",
        canRead: canReadAll,
      }),
    ).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.userId).toBe(ALICE);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION,
    );
    expect(sent[0]!.data.emailEnvelope.vars.decidedBy).toBe("Bob");
    expect(sent[0]!.data.emailEnvelope.vars.reason).toBe(
      "Do not name the vendor.",
    );
    expect(settingsAdded).toEqual([ALICE]);
    // Being told how a note was decided is not a request to act.
    expect(sent[0]!.data.pushNotificationMessage.requireInteraction).toBe(
      false,
    );
  });

  test("a name the Dashboard shows: a person with no name is shown by email", async () => {
    await PublicNoteApprovalNotifications.tellSender({
      facts: facts(),
      sentByUserId: ALICE,
      decidedByUserId: CAROL,
      isApproved: true,
      canRead: canReadAll,
    });

    expect(sent[0]!.data.emailEnvelope.vars.decidedBy).toBe(
      `${CAROL.slice(0, 4)}@example.com`,
    );
  });

  test("tells nobody when there is no sender, the sender decided, or the sender can no longer read it", async () => {
    expect(
      await PublicNoteApprovalNotifications.tellSender({
        facts: facts(),
        sentByUserId: undefined,
        decidedByUserId: BOB,
        isApproved: true,
        canRead: canReadAll,
      }),
    ).toBe(false);

    expect(
      await PublicNoteApprovalNotifications.tellSender({
        facts: facts(),
        sentByUserId: BOB,
        decidedByUserId: BOB,
        isApproved: true,
        canRead: canReadAll,
      }),
    ).toBe(false);

    members.delete(ALICE);

    expect(
      await PublicNoteApprovalNotifications.tellSender({
        facts: facts(),
        sentByUserId: ALICE,
        decidedByUserId: BOB,
        isApproved: true,
        canRead: canReadAll,
      }),
    ).toBe(false);

    expect(sent).toEqual([]);
  });
});
