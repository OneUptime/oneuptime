import SecurityHuntNotifications, {
  SECURITY_HUNT_NOTIFICATION_JOB,
  SecurityHuntFoundFacts,
  SecurityHuntMessage,
  SecurityHuntRecipient,
  buildHuntFoundMessage,
  describeHuntSearch,
  describeSecurityEventCount,
  formatHuntTime,
  getHuntLinkInDashboard,
} from "../../../../../Server/Utils/SecurityEvent/Hunts/SecurityHuntNotifications";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import Queue, { QueueName } from "../../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityHuntService from "../../../../../Server/Services/SecurityHuntService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import UserNotificationSettingService, {
  SECURITY_HUNT_NOTIFICATION_EVENT_TYPES,
} from "../../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../../Server/Utils/Logger";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityHunt from "../../../../../Models/DatabaseModels/SecurityHunt";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../../Types/Email";
import EmailTemplateType from "../../../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import Name from "../../../../../Types/Name";
import NotificationSettingEventType from "../../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
} from "../../../../../Types/SecurityEvent/SecurityHunt";
import Timezone from "../../../../../Types/Timezone";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TELLING PEOPLE WHAT A SCHEDULED HUNT FOUND (SecurityHuntNotifications).
 *
 * A run that found events queues one job; the job tells the people the
 * hunt names and its teams' members - each once, and only those who can
 * read the project's hunts and its security events - through each
 * person's own notification settings. What they are told is the hunt, how
 * many events, and when they arrived, with a link to the hunt's page on
 * that window; never an event's own words.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const TEAM_ID: ObjectID = new ObjectID("81000000-0000-4000-8000-000000000001");
const MAYA: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000001");
const DIEGO: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000002");
const SAM: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000003");
const LEFT: ObjectID = new ObjectID("80000000-0000-4000-8000-000000000004");
const DASHBOARD: string = "https://oneuptime.acme-commerce.example/dashboard";

const WINDOW: SecurityHuntRunWindow = {
  startTime: new Date("2026-10-28T10:00:00.000Z"),
  endTime: new Date("2026-10-29T10:00:00.000Z"),
};

function person(id: ObjectID, name: string, timezone?: Timezone): User {
  const model: User = new User();
  model._id = id.toString();
  model.name = new Name(name);
  model.email = new Email(
    `${name.split(" ")[0]!.toLowerCase()}@acme-commerce.example`,
  );
  if (timezone) {
    model.timezone = timezone;
  }
  return model;
}

function storedHunt(
  values: Partial<Record<string, unknown>> = {},
): SecurityHunt {
  const model: SecurityHunt = new SecurityHunt();
  model._id = HUNT_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "Encoded PowerShell";
  model.searchQuery = "processname:powershell.exe commandline:-enc";
  model.filters = { "!statusName": ["Failure"] };
  model.schedule = SecurityHuntSchedule.EveryDay;
  model.notifyUsers = [
    person(MAYA, "Maya Chen", Timezone.EuropeLondon),
    person(DIEGO, "Diego Alvarez"),
  ];
  const socTeam: Team = new Team();
  socTeam._id = TEAM_ID.toString();
  model.notifyTeams = [socTeam];
  Object.assign(model, values);
  return model;
}

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

const FACTS: SecurityHuntFoundFacts = {
  huntId: HUNT_ID,
  projectId: PROJECT_ID,
  huntName: "Encoded PowerShell",
  searchQuery: "processname:powershell.exe commandline:-enc",
  filterCount: 1,
  projectName: "Acme Commerce",
  url: `${DASHBOARD}/${PROJECT_ID.toString()}/security-events/hunts/${HUNT_ID.toString()}`,
  eventCount: 3,
  startTime: WINDOW.startTime,
  endTime: WINDOW.endTime,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a message says", () => {
  test("counts events in words", () => {
    expect(describeSecurityEventCount(1)).toBe("1 security event");
    expect(describeSecurityEventCount(3)).toBe("3 security events");
    expect(describeSecurityEventCount(1200)).toBe("1,200 security events");
  });

  test("says the hunt's search as written, and how many filters it keeps beside it", () => {
    expect(
      describeHuntSearch({ searchQuery: " user:root ", filterCount: 0 }),
    ).toBe("user:root");
    expect(
      describeHuntSearch({ searchQuery: "user:root", filterCount: 2 }),
    ).toBe("user:root (and 2 filters)");
    expect(describeHuntSearch({ searchQuery: "", filterCount: 1 })).toBe(
      "1 filter",
    );
  });

  test("says a moment in the person's time zone, else UTC", () => {
    expect(formatHuntTime(WINDOW.startTime)).toContain("UTC");
    expect(formatHuntTime(WINDOW.startTime, Timezone.AsiaKolkata)).not.toBe(
      formatHuntTime(WINDOW.startTime),
    );
  });

  test("links to the hunt's page, on the run's window when there is one", async () => {
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(
      (async (): Promise<URL> => {
        return URL.fromString(DASHBOARD);
      }) as never,
    );

    const plain: string = (
      await getHuntLinkInDashboard({ projectId: PROJECT_ID, huntId: HUNT_ID })
    ).toString();
    const onWindow: URL = await getHuntLinkInDashboard({
      projectId: PROJECT_ID,
      huntId: HUNT_ID,
      window: WINDOW,
    });

    expect(plain).toBe(
      `${DASHBOARD}/${PROJECT_ID.toString()}/security-events/hunts/${HUNT_ID.toString()}`,
    );
    expect(onWindow.toString().startsWith(plain)).toBe(true);
    // The Events page's own range params: a custom window, both ends as ISO.
    const query: URLSearchParams = new URLSearchParams(
      onWindow.toString().split("?")[1] || "",
    );
    expect(query.get("range")).toBe("Custom");
    expect(query.get("start")).toBe("2026-10-28T10:00:00.000Z");
    expect(query.get("end")).toBe("2026-10-29T10:00:00.000Z");
  });

  test("is the hunt, what it found and when, in every form, and the event type people chose to hear", () => {
    const message: SecurityHuntMessage = buildHuntFoundMessage({
      facts: FACTS,
    });

    expect(message.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
    );
    expect(message.templateType).toBe(EmailTemplateType.SecurityHuntFound);
    expect(message.subject).toBe(
      "Hunt found 3 security events: Encoded PowerShell",
    );
    expect(Object.keys(message.emailVars).sort()).toEqual(
      [
        "emailTitle",
        "leadSentence",
        "huntName",
        "huntSearch",
        "foundText",
        "windowText",
        "projectName",
        "huntViewLink",
        "reasonSentence",
      ].sort(),
    );
    expect(message.emailVars["huntSearch"]).toBe(
      "processname:powershell.exe commandline:-enc (and 1 filter)",
    );
    expect(message.emailVars["huntViewLink"]).toBe(FACTS.url);
    expect(message.emailVars["leadSentence"]).toContain(
      formatHuntTime(WINDOW.startTime),
    );
    expect(message.smsText).toContain(
      "Hunt Encoded PowerShell found 3 security events.",
    );
    expect(message.callText).toContain(
      "The scheduled hunt Encoded PowerShell found 3 security events.",
    );
    expect(message.pushTitle).toBe("Hunt found 3 security events");
    expect(message.pushBody).toBe("Encoded PowerShell");
  });

  test("says the window in the reader's time zone", () => {
    const utc: SecurityHuntMessage = buildHuntFoundMessage({ facts: FACTS });
    const kolkata: SecurityHuntMessage = buildHuntFoundMessage({
      facts: FACTS,
      timezone: Timezone.AsiaKolkata,
    });

    expect(kolkata.emailVars["windowText"]).toBe(
      `${formatHuntTime(WINDOW.startTime, Timezone.AsiaKolkata)} to ${formatHuntTime(WINDOW.endTime, Timezone.AsiaKolkata)}`,
    );
    expect(kolkata.emailVars["windowText"]).not.toBe(
      utc.emailVars["windowText"],
    );
  });
});

describe("a run that found events", () => {
  test("queues one job with its project, hunt, count and window", async () => {
    const addJob: Spy = getJestSpyOn(Queue, "addJob").mockResolvedValue(
      undefined as never,
    );

    await expect(
      SecurityHuntNotifications.huntFound({
        projectId: PROJECT_ID,
        securityHuntId: HUNT_ID,
        eventCount: 3,
        window: WINDOW,
      }),
    ).resolves.toBe(true);

    const [queue, jobId, jobName, data] = addJob.mock.calls[0]! as [
      QueueName,
      string,
      string,
      Record<string, unknown>,
    ];

    expect(queue).toBe(QueueName.Worker);
    expect(jobId.startsWith("security-hunt-notification-")).toBe(true);
    expect(jobName).toBe(SECURITY_HUNT_NOTIFICATION_JOB);
    expect(data).toEqual({
      projectId: PROJECT_ID.toString(),
      securityHuntId: HUNT_ID.toString(),
      eventCount: 3,
      startTime: "2026-10-28T10:00:00.000Z",
      endTime: "2026-10-29T10:00:00.000Z",
    });
  });

  test("never fails the run when the job cannot be queued", async () => {
    getJestSpyOn(Queue, "addJob").mockRejectedValue(
      new Error("Redis is down") as never,
    );
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    await expect(
      SecurityHuntNotifications.huntFound({
        projectId: PROJECT_ID,
        securityHuntId: HUNT_ID,
        eventCount: 3,
        window: WINDOW,
      }),
    ).resolves.toBe(false);
  });
});

describe("the job", () => {
  test("drops a job without its project, hunt, window or a count of events found", async () => {
    const notify: Spy = getJestSpyOn(
      SecurityHuntNotifications,
      "notifyHuntFound",
    ).mockResolvedValue([] as never);
    getJestSpyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);

    const good: Record<string, unknown> = {
      projectId: PROJECT_ID.toString(),
      securityHuntId: HUNT_ID.toString(),
      eventCount: 3,
      startTime: "2026-10-28T10:00:00.000Z",
      endTime: "2026-10-29T10:00:00.000Z",
    };

    for (const broken of [
      { ...good, projectId: "not-an-id" },
      { ...good, securityHuntId: undefined },
      { ...good, startTime: "soon" },
      { ...good, endTime: "" },
      { ...good, eventCount: 0 },
      { ...good, eventCount: 2.5 },
      { ...good, eventCount: "three" },
    ]) {
      await SecurityHuntNotifications.runJob(broken as never);
    }

    expect(notify).not.toHaveBeenCalled();

    await SecurityHuntNotifications.runJob(good as never);

    expect(notify).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityHuntId: HUNT_ID,
      eventCount: 3,
      window: WINDOW,
    });
  });
});

describe("who is told", () => {
  let send: Spy;
  let seed: Spy;
  let propsOf: Spy;
  let findHunt: Spy;

  beforeEach(() => {
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(
      (async (): Promise<URL> => {
        return URL.fromString(DASHBOARD);
      }) as never,
    );
    findHunt = getJestSpyOn(SecurityHuntService, "findOneBy").mockResolvedValue(
      storedHunt() as never,
    );
    const project: Project = new Project();
    project.name = "Acme Commerce";
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      project as never,
    );

    // SOC Tier 2: Diego again, Sam, and somebody who has left since.
    const teamMembers: Array<TeamMember> = [DIEGO, SAM, LEFT].map(
      (id: ObjectID): TeamMember => {
        const row: TeamMember = new TeamMember();
        row.userId = id;
        row.user = person(id, id === SAM ? "Sam Okafor" : "Someone Else");
        return row;
      },
    );
    getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue(
      teamMembers as never,
    );

    propsOf = getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<DatabaseCommonInteractionProps> => {
      if (data.userId.toString() === LEFT.toString()) {
        throw new NotAuthorizedException("Not a member of this project");
      }

      if (data.userId.toString() === SAM.toString()) {
        // Sam reads security events, but no role of Sam's reads hunts.
        return member([Permission.ProjectUser, Permission.ReadSecurityEvent]);
      }

      return member([Permission.ProjectUser, Permission.SecurityViewer]);
    }) as never);

    seed = getJestSpyOn(
      UserNotificationSettingService,
      "addSecurityHuntNotificationSettings",
    ).mockResolvedValue(undefined as never);
    send = getJestSpyOn(
      UserNotificationSettingService,
      "sendUserNotification",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  async function notify(): Promise<Array<SecurityHuntRecipient>> {
    return await SecurityHuntNotifications.notifyHuntFound({
      projectId: PROJECT_ID,
      securityHuntId: HUNT_ID,
      eventCount: 3,
      window: WINDOW,
    });
  }

  test("the people the hunt names and its teams' members, each once, who can read hunts and security events", async () => {
    const told: Array<SecurityHuntRecipient> = await notify();

    expect(
      told.map((recipient: SecurityHuntRecipient): string => {
        return recipient.userId.toString();
      }),
    ).toEqual([MAYA.toString(), DIEGO.toString()]);
    expect(send).toHaveBeenCalledTimes(2);
    // Somebody who has left the project is no error of OneUptime's to log.
    expect(logger.error).not.toHaveBeenCalled();
    expect(propsOf).toHaveBeenCalledTimes(4);
  });

  test("reads the hunt as OneUptime, in its project", async () => {
    await notify();

    const read: Record<string, unknown> = findHunt.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(read["query"]).toEqual({ _id: HUNT_ID, projectId: PROJECT_ID });
    expect(read["props"]).toEqual({ isRoot: true });
  });

  test("each through their own notification settings, the hunt's event, in their time zone, with the hunt's page on the window", async () => {
    await notify();

    const toMaya: Record<string, unknown> = send.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    const envelope: Record<string, unknown> = toMaya["emailEnvelope"] as Record<
      string,
      unknown
    >;
    const vars: Record<string, string> = envelope["vars"] as Record<
      string,
      string
    >;

    expect(toMaya["userId"]).toEqual(MAYA);
    expect(toMaya["projectId"]).toEqual(PROJECT_ID);
    expect(toMaya["eventType"]).toBe(
      NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
    );
    expect(envelope["templateType"]).toBe(EmailTemplateType.SecurityHuntFound);
    expect(envelope["isSubjectLiteral"]).toBe(true);
    expect(vars["windowText"]).toBe(
      `${formatHuntTime(WINDOW.startTime, Timezone.EuropeLondon)} to ${formatHuntTime(WINDOW.endTime, Timezone.EuropeLondon)}`,
    );
    expect(vars["projectName"]).toBe("Acme Commerce");
    expect(vars["huntViewLink"]).toContain(
      `/security-events/hunts/${HUNT_ID.toString()}?`,
    );
    expect(vars["huntViewLink"]).toContain("range=Custom");

    const push: Record<string, unknown> = toMaya[
      "pushNotificationMessage"
    ] as Record<string, unknown>;

    expect((push["data"] as Record<string, unknown>)["entityType"]).toBe(
      "security-hunt",
    );
    expect(seed).toHaveBeenCalledWith(MAYA, PROJECT_ID);
  });

  test("one person's failure is nobody else's", async () => {
    send.mockRejectedValueOnce(new Error("SMTP is down") as never);

    const told: Array<SecurityHuntRecipient> = await notify();

    expect(
      told.map((recipient: SecurityHuntRecipient): string => {
        return recipient.userId.toString();
      }),
    ).toEqual([DIEGO.toString()]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("nobody, for a hunt deleted or taken off its schedule since it ran", async () => {
    findHunt.mockResolvedValue(null as never);
    expect(await notify()).toEqual([]);

    findHunt.mockResolvedValue(
      storedHunt({ schedule: SecurityHuntSchedule.NotScheduled }) as never,
    );
    expect(await notify()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  test("nobody, when no one it names can read it", async () => {
    propsOf.mockResolvedValue(member([Permission.ProjectUser]) as never);

    expect(await notify()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the notification setting", () => {
  let store: Map<string, Record<string, unknown>>;

  beforeEach(() => {
    store = new Map<string, Record<string, unknown>>();

    getJestSpyOn(UserNotificationSettingService, "countBy").mockImplementation(
      ((args: { query: { eventType: string } }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(store.has(String(args.query.eventType)) ? 1 : 0),
        );
      }) as never,
    );
    getJestSpyOn(UserNotificationSettingService, "create").mockImplementation(
      ((args: {
        data: UserNotificationSetting;
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting> => {
        store.set(String(args.data.eventType), {
          alertByEmail: Boolean(args.data.alertByEmail),
          alertByPush: Boolean(args.data.alertByPush),
          alertBySMS: Boolean(args.data.alertBySMS),
          isRoot: Boolean(args.props.isRoot),
        });
        return Promise.resolve(args.data);
      }) as never,
    );
  });

  test("is one event, written with email and push on, as root, once", async () => {
    await UserNotificationSettingService.addSecurityHuntNotificationSettings(
      MAYA,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addSecurityHuntNotificationSettings(
      MAYA,
      PROJECT_ID,
    );

    expect([...SECURITY_HUNT_NOTIFICATION_EVENT_TYPES]).toEqual([
      NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
    ]);
    expect(Array.from(store.entries())).toEqual([
      [
        NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
        {
          alertByEmail: true,
          alertByPush: true,
          alertBySMS: false,
          isRoot: true,
        },
      ],
    ]);
    expect(UserNotificationSettingService.create).toHaveBeenCalledTimes(1);
  });

  test("every new member has it, as every other event", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      MAYA,
      PROJECT_ID,
    );

    expect(
      store.has(
        NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
      ),
    ).toBe(true);
  });
});
