import ExceptionAssignmentNotifications, {
  EXCEPTION_NAME_MAX_LENGTH,
  MAX_ASSIGNMENTS_PER_RUN,
  getExceptionNameForMessage,
} from "../../../../Server/Utils/Telemetry/ExceptionAssignmentNotifications";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import TelemetryExceptionActivityService from "../../../../Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import UserEmailService from "../../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import UserSmsService from "../../../../Server/Services/UserSmsService";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import FindBy from "../../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../../Server/Types/Database/FindOneBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import Team from "../../../../Models/DatabaseModels/Team";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionActivity, {
  TelemetryExceptionActivityType,
} from "../../../../Models/DatabaseModels/TelemetryExceptionActivity";
import User from "../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import Name from "../../../../Types/Name";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * TELLING PEOPLE AN EXCEPTION WAS ASSIGNED TO THEM.
 *
 * Who: the person, or each member of the team - members of the project
 * only, who can read the exception, never the one who made the assignment.
 * What: SEND_EXCEPTION_ASSIGNED_NOTIFICATION through each person's own
 * settings, seeded (email on) for a member who has none yet and never
 * changed for one who has. When: once, by the Workers, each entry marked
 * told before anything is sent; nothing for an exception handed to someone
 * else since, or deleted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const EXCEPTION_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-00000000000a",
);
const PRIYA: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000001");
const ALEX: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000002");
const SAM: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000003");
const INVITEE: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000004");
const PLATFORM: ObjectID = new ObjectID("a0000000-0000-4000-8000-000000000001");

const NAMES: Record<string, string> = {
  [PRIYA.toString()]: "Priya Raman",
  [ALEX.toString()]: "Alex Kim",
  [SAM.toString()]: "Sam Lee",
  [INVITEE.toString()]: "Invited Person",
};

function user(id: ObjectID): User {
  const model: User = new User();
  model._id = id.toString();
  model.name = new Name(NAMES[id.toString()] || "Someone");
  model.email = new Email(`${id.toString().slice(-4)}@example.com`);
  return model;
}

function assigned(
  overrides: Partial<TelemetryExceptionActivity> = {},
): TelemetryExceptionActivity {
  const entry: TelemetryExceptionActivity = new TelemetryExceptionActivity();
  entry._id = ObjectID.generate().toString();
  entry.projectId = PROJECT_ID;
  entry.telemetryExceptionId = EXCEPTION_ID;
  entry.activityType = TelemetryExceptionActivityType.Assigned;
  entry.userId = PRIYA;
  Object.assign(entry, overrides);
  return entry;
}

// The state the mocks read.
let teamMembers: Array<ObjectID>;
let projectMembers: Set<string>;
let readers: Set<string>;
let exception: TelemetryException | null;
let sent: Array<{
  userId: string;
  eventType: NotificationSettingEventType;
  subject: string;
  message: string;
  teamId?: string | undefined;
  pushUrl?: string | undefined;
}>;
let seeded: Array<string>;

function exceptionAssignedTo(data: {
  userId?: ObjectID;
  teamId?: ObjectID;
}): TelemetryException {
  const model: TelemetryException = new TelemetryException();
  model._id = EXCEPTION_ID.toString();
  model.projectId = PROJECT_ID;
  model.exceptionType = "TypeError";
  model.message =
    "Cannot read properties of undefined (reading 'id')\n    at checkout (cart.js:10:5)";

  if (data.userId) {
    model.assignToUserId = data.userId;
  }

  if (data.teamId) {
    model.assignToTeamId = data.teamId;
  }

  return model;
}

beforeEach(() => {
  teamMembers = [ALEX, SAM, PRIYA];
  projectMembers = new Set<string>([
    PRIYA.toString(),
    ALEX.toString(),
    SAM.toString(),
  ]);
  readers = new Set<string>([
    PRIYA.toString(),
    ALEX.toString(),
    SAM.toString(),
  ]);
  exception = exceptionAssignedTo({ userId: ALEX });
  sent = [];
  seeded = [];

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation(() => {
      return undefined as never;
    });
  }

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return NAMES[data.id.toString()] ? user(data.id) : null;
  }) as never);

  jest
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockImplementation((async () => {
      return teamMembers.map(user);
    }) as never);

  jest
    .spyOn(TeamMemberService, "filterUsersToProjectMembers")
    .mockImplementation((async (data: { users: Array<User> }) => {
      return data.users.filter((candidate: User): boolean => {
        return projectMembers.has(candidate.id!.toString());
      });
    }) as never);

  jest
    .spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    )
    .mockImplementation((async (data: { userId: ObjectID }) => {
      return { userId: data.userId, tenantId: PROJECT_ID };
    }) as never);

  // The exception: read as OneUptime, and as each person to ask whether they may.
  jest.spyOn(TelemetryExceptionService, "findOneBy").mockImplementation((async (
    findOneBy: FindOneBy<TelemetryException>,
  ) => {
    const props: DatabaseCommonInteractionProps = findOneBy.props;

    if (!props.isRoot && !readers.has(props.userId?.toString() || "")) {
      return null;
    }

    return exception;
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Storefront";
    return project;
  }) as never);

  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team();
    team.name = "Platform";
    return team;
  }) as never);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );

  jest
    .spyOn(UserNotificationSettingService, "ensureSettingExistsForUser")
    .mockImplementation((async (data: { userId: ObjectID }) => {
      seeded.push(data.userId.toString());
    }) as never);

  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (
      data: Parameters<
        typeof UserNotificationSettingService.sendUserNotification
      >[0],
    ) => {
      sent.push({
        userId: data.userId.toString(),
        eventType: data.eventType,
        subject: data.emailEnvelope.subject || "",
        message: String(data.emailEnvelope.vars?.["message"] || ""),
        teamId: data.teamId?.toString(),
        pushUrl: data.pushNotificationMessage.clickAction,
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentTo(): Array<string> {
  return sent
    .map((entry: { userId: string }): string => {
      return entry.userId;
    })
    .sort();
}

describe("who is told", () => {
  test("a person assigned: that person, by the exception's own event", async () => {
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(sentTo()).toEqual([ALEX.toString()]);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    );
  });

  test("a team assigned: each of its members, the one who assigned it left out", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeTeamId: PLATFORM, userId: PRIYA }),
    );

    // Priya is on the team and assigned it: she is not told.
    expect(sentTo()).toEqual([ALEX.toString(), SAM.toString()].sort());
    expect(
      sent.every((entry: { teamId?: string | undefined }): boolean => {
        return entry.teamId === PLATFORM.toString();
      }),
    ).toBe(true);
  });

  test("Assign to me tells nobody: nobody is told about what they did themselves", async () => {
    exception = exceptionAssignedTo({ userId: PRIYA });

    expect(
      await ExceptionAssignmentNotifications.notifyAssignment(
        assigned({ assigneeUserId: PRIYA, userId: PRIYA }),
      ),
    ).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  test("a pending invitation has joined nothing: an invitee on the team is not told", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });
    teamMembers = [ALEX, INVITEE];

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeTeamId: PLATFORM }),
    );

    expect(sentTo()).toEqual([ALEX.toString()]);
  });

  test("someone who may not read the exception - another resource's, a block - is not told", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });
    readers = new Set<string>([SAM.toString()]);

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeTeamId: PLATFORM }),
    );

    expect(sentTo()).toEqual([SAM.toString()]);

    // Each asked as themselves, with their own permissions.
    expect(
      AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject,
    ).toHaveBeenCalledWith({ userId: ALEX, projectId: PROJECT_ID });
  });

  test("a check that fails is a no: they are not told", async () => {
    (
      AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject as unknown as jest.Mock
    ).mockImplementation(async () => {
      throw new Error("not a member");
    });

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(sent).toHaveLength(0);
  });

  test("each person once, though they are both the person and on the team", async () => {
    const recipients: Array<{ userId: ObjectID }> =
      await ExceptionAssignmentNotifications.getRecipients({
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        assigneeUserId: ALEX,
        assigneeTeamId: PLATFORM,
        assignedByUserId: PRIYA,
      });

    expect(
      recipients.map((recipient: { userId: ObjectID }): string => {
        return recipient.userId.toString();
      }),
    ).toEqual([ALEX.toString(), SAM.toString()]);
  });

  test("an exception handed to someone else since, or deleted, tells nobody", async () => {
    exception = exceptionAssignedTo({ userId: SAM });
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    exception = exceptionAssignedTo({});
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    exception = null;
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(sent).toHaveLength(0);
  });

  test("only Assigned entries are told", async () => {
    for (const activityType of Object.values(TelemetryExceptionActivityType)) {
      if (activityType === TelemetryExceptionActivityType.Assigned) {
        continue;
      }

      await ExceptionAssignmentNotifications.notifyAssignment(
        assigned({ activityType, assigneeUserId: ALEX }),
      );
    }

    expect(sent).toHaveLength(0);
  });
});

describe("what they are told", () => {
  test("who assigned which exception, in which project, with a link to it", async () => {
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(sent[0]!.subject).toBe(
      "Exception assigned to you: TypeError: Cannot read properties of undefined (reading 'id')",
    );
    expect(sent[0]!.message).toBe(
      `Priya Raman assigned the exception TypeError: Cannot read properties of undefined (reading 'id') to you, in the project Storefront. You can view it here: https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/exceptions/${EXCEPTION_ID.toString()}`,
    );
    expect(sent[0]!.pushUrl).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/exceptions/${EXCEPTION_ID.toString()}`,
    );
  });

  test("a team's members are told it was their team", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeTeamId: PLATFORM }),
    );

    expect(sent[0]!.subject).toContain("Exception assigned to Platform:");
    expect(sent[0]!.message).toContain(
      "to the team Platform, which you are on",
    );
  });

  test("an API key's assignment names the key", async () => {
    const byKey: TelemetryExceptionActivity = assigned({
      assigneeUserId: ALEX,
      apiKeyName: "Deploy pipeline",
    });
    delete byKey.userId;

    await ExceptionAssignmentNotifications.notifyAssignment(byKey);

    expect(
      sent[0]!.message.startsWith("The API key Deploy pipeline assigned"),
    ).toBe(true);
  });

  test("the messages, channel by channel", () => {
    const messages: ReturnType<
      typeof ExceptionAssignmentNotifications.buildMessages
    > = ExceptionAssignmentNotifications.buildMessages(
      {
        projectId: PROJECT_ID,
        telemetryExceptionId: EXCEPTION_ID,
        exceptionName: "TypeError: x",
        assignedBy: "Priya Raman",
        teamName: null,
        projectName: "Storefront",
        url: "https://oneuptime.example.com/dashboard/p/exceptions/e",
      },
      { userId: ALEX, name: "Alex Kim" },
    );

    expect(messages.emailEnvelope.templateType).toBe(
      EmailTemplateType.SimpleMessage,
    );
    expect(messages.emailEnvelope.isSubjectLiteral).toBe(true);
    expect(messages.smsMessage.message).toContain(
      "An exception was assigned to you: TypeError: x.",
    );
    expect(messages.callRequestMessage.data[0]).toMatchObject({
      sayMessage: expect.stringContaining(
        "Priya Raman assigned an exception to you",
      ),
    });
    expect(messages.pushNotificationMessage.title).toBe(
      "Exception assigned to you",
    );
    expect(messages.whatsAppMessage.body).toBe(messages.smsMessage.message);
  });

  test("an exception's name: its type and its message's first line, cut - read without a regular expression over megabytes", () => {
    expect(
      getExceptionNameForMessage({
        exceptionType: "TypeError",
        message: "x\ny",
      }),
    ).toBe("TypeError: x");
    expect(getExceptionNameForMessage({ message: "only a message" })).toBe(
      "only a message",
    );
    expect(getExceptionNameForMessage({})).toBe("An exception");

    const huge: string = "a".repeat(4 * 1024 * 1024);
    const started: number = Date.now();
    const name: string = getExceptionNameForMessage({
      exceptionType: "Error",
      message: huge,
    });

    expect(name.length).toBe(EXCEPTION_NAME_MAX_LENGTH);
    expect(name.endsWith("…")).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("each person's settings decide", () => {
  test("the setting is seeded before it is sent - email on - for a member who has none yet", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeTeamId: PLATFORM }),
    );

    expect(seeded.sort()).toEqual([ALEX.toString(), SAM.toString()].sort());
    expect(
      (
        UserNotificationSettingService.ensureSettingExistsForUser as unknown as jest.Mock
      ).mock.calls[0]![0],
    ).toMatchObject({
      projectId: PROJECT_ID,
      eventType:
        NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    });
  });

  test("a setting that is there is never changed: one switched off stays off", async () => {
    (
      UserNotificationSettingService.ensureSettingExistsForUser as unknown as jest.Mock
    ).mockRestore();

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const create: SpyInstance<typeof UserNotificationSettingService.create> =
      jest
        .spyOn(UserNotificationSettingService, "create")
        .mockResolvedValue(new UserNotificationSetting() as never);

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(create).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  test("a person who switched every channel off gets nothing: sendUserNotification reads their setting", async () => {
    (
      UserNotificationSettingService.sendUserNotification as unknown as jest.Mock
    ).mockRestore();

    const off: UserNotificationSetting = new UserNotificationSetting();
    off.alertByEmail = false;
    off.alertBySMS = false;
    off.alertByCall = false;
    off.alertByPush = false;
    off.alertByWhatsApp = false;
    off.alertByTelegram = false;
    off.alertBySlack = false;
    off.alertByMicrosoftTeams = false;
    off.alertByWebhook = false;
    off.alertByCustomChannel = false;

    const readSetting: SpyInstance<
      typeof UserNotificationSettingService.findOneBy
    > = jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(off as never);
    const emails: SpyInstance<typeof UserEmailService.findBy> = jest
      .spyOn(UserEmailService, "findBy")
      .mockResolvedValue([] as never);
    const phones: SpyInstance<typeof UserSmsService.findBy> = jest
      .spyOn(UserSmsService, "findBy")
      .mockResolvedValue([] as never);

    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(readSetting).toHaveBeenCalled();
    expect(
      (readSetting.mock.calls[0]![0] as FindOneBy<UserNotificationSetting>)
        .query["eventType"],
    ).toBe(NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION);
    expect(emails).not.toHaveBeenCalled();
    expect(phones).not.toHaveBeenCalled();

    // Email switched on: their verified addresses are read, to be sent to.
    off.alertByEmail = true;
    await ExceptionAssignmentNotifications.notifyAssignment(
      assigned({ assigneeUserId: ALEX }),
    );

    expect(emails).toHaveBeenCalledTimes(1);
    expect(phones).not.toHaveBeenCalled();
  });

  test("one person's broken setting never costs the others theirs", async () => {
    exception = exceptionAssignedTo({ teamId: PLATFORM });
    (
      UserNotificationSettingService.sendUserNotification as unknown as jest.Mock
    ).mockImplementation(async (data: { userId: ObjectID }) => {
      if (data.userId.toString() === ALEX.toString()) {
        throw new Error("no such setting");
      }
      sent.push({
        userId: data.userId.toString(),
        eventType:
          NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
        subject: "",
        message: "",
      });
    });

    const notified: Array<ObjectID> =
      await ExceptionAssignmentNotifications.notifyAssignment(
        assigned({ assigneeTeamId: PLATFORM }),
      );

    expect(
      notified.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SAM.toString()]);
    expect(sentTo()).toEqual([SAM.toString()]);
  });
});

describe("the Workers' run", () => {
  let pending: Array<TelemetryExceptionActivity>;
  let marked: Array<string>;
  let order: Array<string>;

  beforeEach(() => {
    pending = [];
    marked = [];
    order = [];

    jest
      .spyOn(TelemetryExceptionActivityService, "findBy")
      .mockImplementation((async (
        findBy: FindBy<TelemetryExceptionActivity>,
      ) => {
        expect(findBy.props).toEqual({ isRoot: true });
        expect(findBy.limit).toBe(MAX_ASSIGNMENTS_PER_RUN);
        expect(findBy.query).toEqual({
          activityType: TelemetryExceptionActivityType.Assigned,
          isAssigneeNotified: false,
        });
        return pending;
      }) as never);

    jest
      .spyOn(TelemetryExceptionActivityService, "updateBy")
      .mockImplementation((async (
        updateBy: UpdateBy<TelemetryExceptionActivity>,
      ) => {
        const id: string = String(
          (updateBy.query as Record<string, unknown>)["_id"],
        );
        expect(updateBy.data).toEqual({ isAssigneeNotified: true });
        expect(
          (updateBy.query as Record<string, unknown>)["isAssigneeNotified"],
        ).toBe(false);

        if (marked.includes(id)) {
          return 0;
        }

        marked.push(id);
        order.push(`mark:${id}`);
        return 1;
      }) as never);

    (
      UserNotificationSettingService.sendUserNotification as unknown as jest.Mock
    ).mockImplementation(async (data: { userId: ObjectID }) => {
      order.push(`send:${data.userId.toString()}`);
    });
  });

  test("each entry is marked told before anything is sent for it", async () => {
    const entry: TelemetryExceptionActivity = assigned({
      assigneeUserId: ALEX,
    });
    pending = [entry];

    expect(
      await ExceptionAssignmentNotifications.sendPendingNotifications(),
    ).toBe(1);

    expect(order).toEqual([
      `mark:${entry.id!.toString()}`,
      `send:${ALEX.toString()}`,
    ]);
  });

  test("an entry another worker took first is not told twice", async () => {
    const entry: TelemetryExceptionActivity = assigned({
      assigneeUserId: ALEX,
    });
    marked = [entry.id!.toString()];
    pending = [entry];

    expect(
      await ExceptionAssignmentNotifications.sendPendingNotifications(),
    ).toBe(0);
    expect(order).toEqual([]);
  });

  test("a failure is dropped, not retried: the entry stays marked, and the next one is still told", async () => {
    const first: TelemetryExceptionActivity = assigned({
      assigneeUserId: ALEX,
    });
    const second: TelemetryExceptionActivity = assigned({
      assigneeUserId: ALEX,
    });
    pending = [first, second];

    let reads: number = 0;
    (
      TelemetryExceptionService.findOneBy as unknown as jest.Mock
    ).mockImplementation(async (findOneBy: FindOneBy<TelemetryException>) => {
      if (findOneBy.props.isRoot) {
        reads++;
        if (reads === 1) {
          throw new Error("connection lost");
        }
      }
      return exception;
    });

    expect(
      await ExceptionAssignmentNotifications.sendPendingNotifications(),
    ).toBe(2);
    expect(marked).toEqual([first.id!.toString(), second.id!.toString()]);
    expect(
      order.filter((step: string): boolean => {
        return step.startsWith("send:");
      }),
    ).toEqual([`send:${ALEX.toString()}`]);
  });
});
