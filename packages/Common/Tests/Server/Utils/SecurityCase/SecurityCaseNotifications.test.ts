import Queue from "../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import { securityCaseGroupingKey } from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityCaseNotifications, {
  SECURITY_CASE_NOTIFICATION_JOB,
  SECURITY_CASE_PRIORITY_NOTIFICATION_DELAY_MS,
  SecurityCaseMessageFacts,
  SecurityCaseNotificationKind,
  buildApprovalRequestedMessage,
  buildAssignedMessage,
  buildPriorityReachedMessage,
  describeEntities,
  describeRunTrigger,
  describeStep,
  isSetupTestCase,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityCaseNotificationChoiceKind } from "../../../../Utils/SecurityCase/SecurityCaseNotificationPriority";
import { Orange } from "../../../../Types/BrandColors";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SETUP_TEST_SOURCE_IP } from "../../../../Types/SecurityEvent/SecuritySetupTest";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getJestSpyOn } from "../../../Spy";
import {
  buildDefaultTestPriorities,
  testPriorityId,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SecurityCaseNotifications: who is told about a security case, what they
 * are told, and that each is told once.
 *
 * The database is a small in-memory project - its members and their roles,
 * teams, notification settings, one case and one run - behind the services'
 * read and write methods. The permission check is the real one
 * (CallerPermission over each member's own permission rows), and a role
 * limited to labels is the case's own read refusing them, as the database
 * layer does.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const BLUE_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/project/security-events/cases/case";

interface Member {
  id: ObjectID;
  name: string;
  email: string;
  permissions: Array<Permission>;
  teamIds: Array<string>;
  // Their role reads only cases with a label this case lacks.
  limitedToOtherLabels?: boolean | undefined;
  setting?: Partial<UserNotificationSetting> | undefined;
}

function member(
  name: string,
  index: number,
  permissions: Array<Permission>,
  extra: Partial<Member> = {},
): Member {
  return {
    id: new ObjectID(
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    ),
    name,
    email: `${name.toLowerCase()}@example.com`,
    permissions,
    teamIds: [],
    ...extra,
  };
}

let members: Array<Member>;
let securityCase: SecurityCase;
let run: SecurityPlaybookRun | null;
let sent: Array<{
  userId: string;
  eventType: string;
  subject: string;
  data: JSONObject;
}>;
let feedItems: Array<JSONObject>;
let channelPosts: Array<JSONObject>;
let queued: Array<{ jobName: string; data: JSONObject; options: JSONObject }>;
let seeded: Array<string>;

function caseModel(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.caseNumberWithPrefix = "CASE-12";
  model.title = "Brute force against admin";
  model.description = "Ten failed sign-ins in a minute.";
  model.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  model.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  model.source = SecurityDetectionSource.DetectionRule;
  model.entities = [
    { type: SecurityEntityType.IpAddress, value: "198.51.100.7" },
  ] as unknown as JSONArray;
  model.mitreTactics = ["TA0006"];
  model.detectionCount = 1;
  model.groupingKey = "entity:198.51.100.7";
  model.createdAt = new Date();
  Object.assign(model, overrides);
  return model;
}

function propsFor(person: Member): DatabaseCommonInteractionProps {
  return {
    userId: person.id,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectUser, ...person.permissions].map(
          (permission: Permission) => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
            };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function findMember(userId: unknown): Member | undefined {
  return members.find((person: Member): boolean => {
    return person.id.toString() === String(userId);
  });
}

beforeEach(() => {
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
  members = [];
  securityCase = caseModel();
  run = null;
  sent = [];
  feedItems = [];
  channelPosts = [];
  queued = [];
  seeded = [];

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async (args: unknown) => {
      const { props } = args as { props: DatabaseCommonInteractionProps };

      if (props.isRoot) {
        return securityCase;
      }

      // A member's own read: refused when their role is limited to labels.
      const person: Member | undefined = findMember(props.userId);

      if (person?.limitedToOtherLabels) {
        throw new NotAuthorizedException("Not allowed to read this case.");
      }

      return securityCase;
    },
  );

  getJestSpyOn(
    SecurityCaseService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(async (args: unknown) => {
    const { data, expectedData } = args as {
      data: JSONObject;
      expectedData: JSONObject;
    };

    const current: string = securityCase.notifiedSecurityCasePriorityId
      ? securityCase.notifiedSecurityCasePriorityId.toString()
      : "";
    const expected: string = expectedData["notifiedSecurityCasePriorityId"]
      ? String(expectedData["notifiedSecurityCasePriorityId"])
      : "";

    if (current !== expected) {
      return false;
    }

    securityCase.notifiedSecurityCasePriorityId = data[
      "notifiedSecurityCasePriorityId"
    ] as unknown as ObjectID;
    return true;
  });

  getJestSpyOn(SecurityCaseService, "getCaseLinkInDashboard").mockResolvedValue(
    URL.fromString(CASE_URL) as never,
  );

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project();
    project.name = "Acme";
    return project;
  });

  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(
    async (args: unknown) => {
      const { query } = args as { query: JSONObject };
      const teamId: string | undefined = query["teamId"]
        ? String(query["teamId"])
        : undefined;

      return members
        .filter((person: Member): boolean => {
          return !teamId || person.teamIds.includes(teamId);
        })
        .map((person: Member): TeamMember => {
          const row: TeamMember = new TeamMember();
          row.userId = person.id;
          const user: User = new User();
          user.name = person.name as never;
          user.email = person.email as never;
          row.user = user;
          return row;
        });
    },
  );

  getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (args: unknown) => {
      const person: Member | undefined = findMember(
        (args as { id: ObjectID }).id,
      );

      if (!person) {
        return null;
      }

      const user: User = new User();
      user.name = person.name as never;
      user.email = person.email as never;
      return user;
    },
  );

  getJestSpyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "Blue Team";
    return team;
  });

  getJestSpyOn(UserNotificationSettingService, "findBy").mockImplementation(
    async () => {
      return members
        .filter((person: Member): boolean => {
          return Boolean(person.setting);
        })
        .map((person: Member): UserNotificationSetting => {
          const row: UserNotificationSetting = new UserNotificationSetting();
          row.userId = person.id;
          Object.assign(row, person.setting);
          return row;
        });
    },
  );

  getJestSpyOn(
    UserNotificationSettingService,
    "addSecurityCaseNotificationSettings",
  ).mockImplementation(async (userId: unknown) => {
    seeded.push(String(userId));
  });

  getJestSpyOn(
    UserNotificationSettingService,
    "sendUserNotification",
  ).mockImplementation(async (args: unknown) => {
    const data: JSONObject = args as unknown as JSONObject;
    sent.push({
      userId: String(data["userId"]),
      eventType: String(data["eventType"]),
      subject: String(
        (data["emailEnvelope"] as unknown as { subject: string }).subject,
      ),
      data,
    });
  });

  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: unknown) => {
    const person: Member | undefined = findMember(
      (args as { userId: ObjectID }).userId,
    );

    if (!person) {
      return {
        userId: (args as { userId: ObjectID }).userId,
        tenantId: PROJECT_ID,
        userTenantAccessPermission: {},
      } as unknown as DatabaseCommonInteractionProps;
    }

    return propsFor(person);
  });

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (args: unknown) => {
    feedItems.push(args as JSONObject);
  });

  getJestSpyOn(
    WorkspaceNotificationRuleService,
    "sendWorkspaceMarkdownNotification",
  ).mockImplementation(async (args: unknown) => {
    channelPosts.push(args as JSONObject);
  });

  getJestSpyOn(SecurityPlaybookRunService, "findOneBy").mockImplementation(
    async () => {
      return run;
    },
  );

  getJestSpyOn(Queue, "addJob").mockImplementation(
    async (
      _queueName: unknown,
      _jobId: unknown,
      jobName: unknown,
      data: unknown,
      options: unknown,
    ) => {
      queued.push({
        jobName: String(jobName),
        data: data as JSONObject,
        options: (options || {}) as JSONObject,
      });
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentTo(): Array<string> {
  return sent.map((item: { userId: string }): string => {
    const person: Member | undefined = findMember(item.userId);
    return person?.name || item.userId;
  });
}

describe("who is told that a case reached their priority", () => {
  test("everyone who can see cases, at the default High, and nobody who cannot", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember]),
      member("Viewer", 3, [Permission.SecurityViewer]),
      // A project member with no security role reads no case.
      member("Developer", 4, [Permission.ProjectMember]),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sentTo()).toEqual(["Owner", "Analyst", "Viewer"]);
    expect(
      sent.every((item: { eventType: string }): boolean => {
        return (
          item.eventType ===
          NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION
        );
      }),
    ).toBe(true);
    expect(securityCase.notifiedSecurityCasePriorityId?.toString()).toBe(
      testPriorityId(SecurityCasePriorityLevel.Critical).toString(),
    );
  });

  test("a Medium case reaches only the people who chose Medium or below", async () => {
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Medium),
    });
    members = [
      member("Default", 1, [Permission.SecurityAdmin]),
      member("Medium", 2, [Permission.SecurityAdmin], {
        setting: {
          alertByEmail: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Medium,
          ),
        },
      }),
      member("Everything", 3, [Permission.SecurityAdmin], {
        setting: {
          alertByEmail: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Informational,
          ),
        },
      }),
      member("CriticalOnly", 4, [Permission.SecurityAdmin], {
        setting: {
          alertByEmail: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Critical,
          ),
        },
      }),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sentTo()).toEqual(["Medium", "Everything"]);
  });

  test("a rise tells only the people it newly reaches, once", async () => {
    members = [
      member("Default", 1, [Permission.SecurityAdmin]),
      member("Medium", 2, [Permission.SecurityAdmin], {
        setting: {
          alertByEmail: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Medium,
          ),
        },
      }),
      member("CriticalOnly", 3, [Permission.SecurityAdmin], {
        setting: {
          alertByPush: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Critical,
          ),
        },
      }),
    ];

    // Told about at Medium when it opened.
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ),
      notifiedSecurityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Medium,
      ),
    });

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sentTo()).toEqual(["Default", "CriticalOnly"]);
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Security case is now Critical: Brute force against admin",
    );

    // The same rise handed over again tells nobody.
    sent = [];
    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
    expect(sent).toEqual([]);
  });

  test("of two workers handed the same rise, only the one that claims it tells people", async () => {
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    // Another worker claimed it between the read and the write.
    getJestSpyOn(
      SecurityCaseService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(false as never);

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sent).toEqual([]);
    expect(feedItems).toEqual([]);
    expect(channelPosts).toEqual([]);
  });

  test("a case lowered, or no higher than it was told at, tells nobody", async () => {
    members = [member("Analyst", 1, [Permission.SecurityMember])];
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
      notifiedSecurityCasePriorityId: testPriorityId(
        SecurityCasePriorityLevel.Critical,
      ),
    });

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sent).toEqual([]);
    expect(securityCase.notifiedSecurityCasePriorityId?.toString()).toBe(
      testPriorityId(SecurityCasePriorityLevel.Critical).toString(),
    );
  });

  test("the person who opened or raised it, someone with every channel off, and a role limited to other labels are not told", async () => {
    members = [
      member("Actor", 1, [Permission.SecurityMember]),
      member("Muted", 2, [Permission.SecurityMember], {
        setting: { alertByEmail: false, alertByPush: false },
      }),
      member("Labelled", 3, [Permission.SecurityMember], {
        limitedToOtherLabels: true,
      }),
      member("Analyst", 4, [Permission.SecurityMember]),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      actorUserId: members[0]!.id,
    });

    expect(sentTo()).toEqual(["Analyst"]);
  });

  test("the setup test's case and a closed case notify nobody", async () => {
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    securityCase = caseModel({
      groupingKey: securityCaseGroupingKey({
        groupValue: SETUP_TEST_SOURCE_IP,
        fingerprint: "",
      }),
    });
    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    securityCase = caseModel({
      securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
    });
    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sent).toEqual([]);
    expect(channelPosts).toEqual([]);
  });

  test("says who was told on the case, posts to the case's channels, and seeds the settings of whoever it tells", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember]),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(seeded).toEqual([
      members[0]!.id.toString(),
      members[1]!.id.toString(),
    ]);
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["eventType"]).toBe(
      SecurityCaseFeedEventType.Notification,
    );
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 2 people of this new **Critical** case.",
    );
    expect(feedItems[0]!["moreInformationInMarkdown"]).toBe(
      "- Owner (owner@example.com)\n- Analyst (analyst@example.com)",
    );

    expect(channelPosts).toHaveLength(1);
    expect(
      (channelPosts[0]!["notificationFor"] as JSONObject)["securityCaseId"],
    ).toEqual(CASE_ID);
    expect(String(channelPosts[0]!["feedInfoInMarkdown"])).toContain(
      "🛡️ **New Critical security case**",
    );
    expect(String(channelPosts[0]!["feedInfoInMarkdown"])).toContain(
      `**[CASE-12](${CASE_URL})** Brute force against admin`,
    );
  });

  test("nobody to tell writes no feed entry, and the channels are still posted to", async () => {
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Low),
    });
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sent).toEqual([]);
    expect(feedItems).toEqual([]);
    expect(channelPosts).toHaveLength(1);
    expect(securityCase.notifiedSecurityCasePriorityId?.toString()).toBe(
      testPriorityId(SecurityCasePriorityLevel.Low).toString(),
    );
  });

  test("a Critical case is sent at once, never rolled up, and with every channel's copy", async () => {
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    const data: JSONObject = sent[0]!.data;
    expect(data["forceImmediate"]).toBe(true);
    expect(data["securityCaseId"]).toEqual(CASE_ID);
    expect(
      (data["emailEnvelope"] as unknown as { templateType: string })
        .templateType,
    ).toBe(EmailTemplateType.SecurityCaseOpened);
    expect((data["smsMessage"] as unknown as { message: string }).message).toBe(
      "OneUptime: New Critical security case CASE-12: Brute force against admin. Turn off in User Settings > Notification Settings.",
    );
    expect(
      (data["pushNotificationMessage"] as unknown as { title: string }).title,
    ).toBe("New Critical security case CASE-12");
  });

  test("names the priority as the project calls it, and reads urgency off its place", async () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[0]!.name = "Sev 1";
    stubSecurityCaseValues({ priorities });
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sent[0]!.subject).toBe(
      "[CASE-12] New Sev 1 security case: Brute force against admin",
    );
    // Still the project's critical priority: sent at once.
    expect(sent[0]!.data["forceImmediate"]).toBe(true);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 1 person of this new **Sev 1** case.",
    );
  });

  test("a case at a priority of the project's own above Critical is critical too", async () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities().map((priority: SecurityCasePriority) => {
        priority.order = (priority.order || 0) + 1;
        return priority;
      });
    const emergency: SecurityCasePriority = new SecurityCasePriority();
    emergency._id = "c1000000-0000-4000-8000-0000000000e1";
    emergency.name = "Emergency";
    emergency.order = 1;
    priorities.push(emergency);
    stubSecurityCaseValues({ priorities });
    securityCase = caseModel({
      securityCasePriorityId: new ObjectID(emergency._id),
    });
    members = [
      member("CriticalOnly", 1, [Permission.SecurityMember], {
        setting: {
          alertByEmail: true,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Critical,
          ),
        },
      }),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sentTo()).toEqual(["CriticalOnly"]);
    expect(sent[0]!.data["forceImmediate"]).toBe(true);
    expect(securityCase.notifiedSecurityCasePriorityId?.toString()).toBe(
      emergency._id,
    );
  });

  test("a person whose setting lost its priority hears at the default", async () => {
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.High),
    });
    members = [
      member("Odd", 1, [Permission.SecurityMember], {
        setting: {
          alertByEmail: true,
          // A priority the project no longer has.
          minimumSecurityCasePriorityId: new ObjectID(
            "c1000000-0000-4000-8000-0000000000ff",
          ),
        },
      }),
    ];

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(sentTo()).toEqual(["Odd"]);
  });
});

describe("who is told that a case is assigned", () => {
  test("the person it is assigned to, told it is theirs", async () => {
    const alice: Member = member("Alice", 1, [Permission.SecurityMember]);
    const lead: Member = member("Lead", 2, [Permission.SecurityAdmin]);
    members = [alice, lead];
    securityCase = caseModel({ assignedToUserId: alice.id });

    await SecurityCaseNotifications.notifyAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      userId: alice.id,
      actorUserId: lead.id,
    });

    expect(sentTo()).toEqual(["Alice"]);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
    );
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Security case assigned to you: Brute force against admin",
    );
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["leadSentence"]).toBe(
      "Lead assigned this Critical security case to you.",
    );
  });

  test("the members of the team it moved to who can see it, but not the person who moved it", async () => {
    const bob: Member = member("Bob", 1, [Permission.SecurityMember], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    const carol: Member = member("Carol", 2, [Permission.SecurityMember], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    const dev: Member = member("Dev", 3, [Permission.ProjectMember], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    const other: Member = member("Other", 4, [Permission.SecurityMember]);
    members = [bob, carol, dev, other];
    securityCase = caseModel({ assignedToTeamId: BLUE_TEAM_ID });

    await SecurityCaseNotifications.notifyAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      teamId: BLUE_TEAM_ID,
      actorUserId: carol.id,
      playbookName: undefined,
    });

    expect(sentTo()).toEqual(["Bob"]);
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Security case assigned to Blue Team: Brute force against admin",
    );
  });

  test("a person named directly reads 'you', even when they are on the team too", async () => {
    const bob: Member = member("Bob", 1, [Permission.SecurityMember], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    members = [bob];
    securityCase = caseModel({
      assignedToUserId: bob.id,
      assignedToTeamId: BLUE_TEAM_ID,
    });

    await SecurityCaseNotifications.notifyAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      userId: bob.id,
      teamId: BLUE_TEAM_ID,
      playbookName: "Triage",
    });

    expect(sentTo()).toEqual(["Bob"]);
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Security case assigned to you: Brute force against admin",
    );
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["leadSentence"]).toBe(
      "Playbook Triage assigned this Critical security case to you.",
    );
  });

  test("a case handed on again before the job ran tells the first person nothing", async () => {
    const alice: Member = member("Alice", 1, [Permission.SecurityMember]);
    const bob: Member = member("Bob", 2, [Permission.SecurityMember]);
    members = [alice, bob];
    securityCase = caseModel({ assignedToUserId: bob.id });

    await SecurityCaseNotifications.notifyAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      userId: alice.id,
    });

    expect(sent).toEqual([]);
    expect(channelPosts).toEqual([]);
  });

  test("an assignee who cannot see the case is not told", async () => {
    const dev: Member = member("Dev", 1, [Permission.ProjectMember]);
    members = [dev];
    securityCase = caseModel({ assignedToUserId: dev.id });

    await SecurityCaseNotifications.notifyAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      userId: dev.id,
    });

    expect(sent).toEqual([]);
    // The channels hear of it all the same.
    expect(channelPosts).toHaveLength(1);
  });
});

describe("who is asked to approve a playbook step", () => {
  function waitingRun(overrides: Partial<SecurityPlaybookRun> = {}): void {
    run = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.status = SecurityPlaybookRunStatus.WaitingForApproval;
    run.playbookName = "Contain compromised host";
    run.trigger = SecurityPlaybookTrigger.CaseOpened;
    run.currentStepIndex = 1;
    run.steps = [
      {
        id: "s1",
        action: SecurityPlaybookActionType.CheckThreatIntel,
        config: {},
        requiresApproval: false,
        continueOnFailure: false,
        onlyIfThreatIntelMatched: false,
      },
      {
        id: "s2",
        action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
        config: { connectionId: "66666666-6666-4666-8666-666666666666" },
        requiresApproval: true,
        continueOnFailure: false,
        onlyIfThreatIntelMatched: false,
      },
    ] as unknown as JSONArray;
    Object.assign(run, overrides);
  }

  test("the people on the case who can approve: its assignee and its team, not a viewer", async () => {
    const alice: Member = member("Alice", 1, [Permission.SecurityMember]);
    const bob: Member = member("Bob", 2, [Permission.SecurityMember], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    const viewer: Member = member("Viewer", 3, [Permission.SecurityViewer], {
      teamIds: [BLUE_TEAM_ID.toString()],
    });
    const admin: Member = member("Admin", 4, [Permission.SecurityAdmin]);
    members = [alice, bob, viewer, admin];
    securityCase = caseModel({
      assignedToUserId: alice.id,
      assignedToTeamId: BLUE_TEAM_ID,
    });
    waitingRun();

    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    expect(sentTo().sort()).toEqual(["Alice", "Bob"]);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    );
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Approval needed: Contain compromised host, step 2 (Contain the host in CrowdStrike)",
    );
    expect(sent[0]!.data["forceImmediate"]).toBe(true);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Asked 2 people to approve step 2 (Contain the host in CrowdStrike) of playbook **Contain compromised host**.",
    );
  });

  test("the approver is told which hosts the step would contain, and not the ones it leaves alone", async () => {
    members = [member("Admin", 1, [Permission.SecurityAdmin])];
    waitingRun({
      stepResults: [
        { stepId: "s1", action: SecurityPlaybookActionType.CheckThreatIntel },
        {
          stepId: "s2",
          action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
          status: SecurityPlaybookStepStatus.WaitingForApproval,
          targets: [
            {
              type: SecurityEntityType.Host,
              value: "web-01",
              reason: SecurityPlaybookTargetReason.GroupedOn,
              state: SecurityPlaybookTargetState.Proposed,
            },
            {
              type: SecurityEntityType.Host,
              value: "dc-01",
              reason: SecurityPlaybookTargetReason.GroupedOn,
              state: SecurityPlaybookTargetState.Protected,
            },
            {
              type: SecurityEntityType.Host,
              value: "db-02",
              reason: SecurityPlaybookTargetReason.ThreatIntel,
              state: SecurityPlaybookTargetState.Proposed,
            },
          ],
        },
      ] as unknown as JSONArray,
    });

    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["stepTargets"]).toBe("web-01, db-02");
    expect(
      (sent[0]!.data["smsMessage"] as unknown as { message: string }).message,
    ).toContain(
      "playbook Contain compromised host, step 2 (Contain the host in CrowdStrike) on web-01, db-02.",
    );
  });

  test("a step that acts on nobody in particular names no targets", async () => {
    members = [member("Admin", 1, [Permission.SecurityAdmin])];
    waitingRun();

    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["stepTargets"]).toBe("");
    expect(
      (sent[0]!.data["smsMessage"] as unknown as { message: string }).message,
    ).toContain(
      "playbook Contain compromised host, step 2 (Contain the host in CrowdStrike).",
    );
  });

  test("everyone who can approve, when nobody on the case can, but not the person who started the run", async () => {
    const starter: Member = member("Starter", 1, [Permission.SecurityMember]);
    const admin: Member = member("Admin", 2, [Permission.SecurityAdmin]);
    const viewer: Member = member("Viewer", 3, [Permission.SecurityViewer]);
    const owner: Member = member("Owner", 4, [Permission.ProjectOwner]);
    members = [starter, admin, viewer, owner];
    securityCase = caseModel({ assignedToUserId: viewer.id });
    waitingRun({
      triggeredByUserId: starter.id,
      trigger: SecurityPlaybookTrigger.Manual,
    });

    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    expect(sentTo()).toEqual(["Admin", "Owner"]);
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["startedBy"]).toBe("Starter");
    expect(vars["reasonSentence"]).toContain("nobody the case is assigned to");
  });

  test("a run decided or cancelled before the job ran asks nobody", async () => {
    members = [member("Admin", 1, [Permission.SecurityAdmin])];
    waitingRun({ status: SecurityPlaybookRunStatus.Cancelled });

    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    run = null;
    await SecurityCaseNotifications.notifyApprovalRequested({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      runId: RUN_ID,
    });

    expect(sent).toEqual([]);
    expect(channelPosts).toEqual([]);
  });
});

describe("who can read a case", () => {
  test("a member whose role reads cases, and nobody who has left", async () => {
    const analyst: Member = member("Analyst", 1, [Permission.SecurityMember]);
    members = [analyst];

    expect(
      await SecurityCaseNotifications.canReadCase({
        userId: analyst.id,
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(true);

    expect(
      await SecurityCaseNotifications.canReadCase({
        userId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(false);
  });

  test("a block on reading cases wins over the role that grants it", async () => {
    const blocked: Member = member("Blocked", 1, [Permission.SecurityMember]);
    members = [blocked];

    getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockImplementation(async () => {
      const props: DatabaseCommonInteractionProps = propsFor(blocked);
      (
        props.userTenantAccessPermission![PROJECT_ID.toString()]!
          .permissions as Array<JSONObject>
      ).push({
        _type: "UserPermission",
        permission: Permission.ReadSecurityCase,
        labelIds: [],
        isBlockPermission: true,
      });
      return props;
    });

    expect(
      await SecurityCaseNotifications.canReadCase({
        userId: blocked.id,
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(false);
  });

  test("an unexpected error reads as 'cannot' rather than telling anyone", async () => {
    const analyst: Member = member("Analyst", 1, [Permission.SecurityMember]);
    members = [analyst];

    getJestSpyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ).mockRejectedValue(new Error("cache down") as never);

    expect(
      await SecurityCaseNotifications.canReadCase({
        userId: analyst.id,
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toBe(false);
  });
});

describe("queueing", () => {
  test("a case at a priority is queued a moment from now, on the worker queue, retried", async () => {
    await SecurityCaseNotifications.caseReachedPriority({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.jobName).toBe(SECURITY_CASE_NOTIFICATION_JOB);
    expect(queued[0]!.data).toEqual({
      kind: SecurityCaseNotificationKind.PriorityReached,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });
    expect(queued[0]!.options["delayInMs"]).toBe(
      SECURITY_CASE_PRIORITY_NOTIFICATION_DELAY_MS,
    );
    expect(queued[0]!.options["attempts"]).toBe(3);
  });

  test("an assignment with nobody assigned queues nothing; one with a team queues it at once", async () => {
    await SecurityCaseNotifications.caseAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
    expect(queued).toEqual([]);

    await SecurityCaseNotifications.caseAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      teamId: BLUE_TEAM_ID,
      playbookName: "Triage",
    });
    expect(queued[0]!.data).toEqual({
      kind: SecurityCaseNotificationKind.Assigned,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      teamId: BLUE_TEAM_ID.toString(),
      playbookName: "Triage",
    });
    expect(queued[0]!.options["delayInMs"]).toBeUndefined();
  });

  test("a queue that is down never fails the change that asked", async () => {
    getJestSpyOn(Queue, "addJob").mockRejectedValue(
      new Error("redis down") as never,
    );

    await expect(
      SecurityCaseNotifications.approvalRequested({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBeUndefined();
  });

  test("the job runs each kind, and drops one it cannot read", async () => {
    members = [member("Analyst", 1, [Permission.SecurityMember])];

    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.PriorityReached,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });
    expect(sentTo()).toEqual(["Analyst"]);

    sent = [];
    await SecurityCaseNotifications.runJob({
      kind: "Something else",
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });
    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.PriorityReached,
      projectId: "not-an-id",
      securityCaseId: CASE_ID.toString(),
    });
    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.ApprovalRequested,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });
    expect(sent).toEqual([]);
  });
});

describe("what the messages say", () => {
  const facts: SecurityCaseMessageFacts = {
    caseId: CASE_ID,
    projectId: PROJECT_ID,
    number: "CASE-7",
    title: "Credential dumping on web-01",
    priority: "High",
    priorityColor: Orange,
    isCritical: false,
    status: "Investigating",
    source: SecurityDetectionSource.ThreatIntel,
    assignee: "Unassigned",
    entities: [{ type: SecurityEntityType.Host, value: "web-01" }],
    mitreTactics: ["TA0006"],
    detectionCount: 2,
    projectName: "Acme",
    url: CASE_URL,
    descriptionHtml: "<p>Mimikatz</p>",
  };

  test("a High case is new, rolled up with the others when there are many", () => {
    const message: ReturnType<typeof buildPriorityReachedMessage> =
      buildPriorityReachedMessage({
        facts,
        isNew: true,
        minimum: {
          name: "High",
          kind: SecurityCaseNotificationChoiceKind.AndAbove,
        },
      });

    expect(message.subject).toBe(
      "[CASE-7] New High security case: Credential dumping on web-01",
    );
    expect(message.forceImmediate).toBe(false);
    expect(message.requireInteraction).toBe(false);
    expect(message.emailVars["reasonSentence"]).toContain(
      "your chosen priority: High and above",
    );
    expect(message.emailVars["caseEntities"]).toBe("web-01 (Host)");
    expect(message.emailVars["caseMitreTactics"]).toContain("TA0006");
    expect(message.emailVars["priorityColor"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("an assignment to a team names the team; an approval names the step", () => {
    expect(buildAssignedMessage({ facts, teamName: "Blue Team" }).smsText).toBe(
      "OneUptime: Security case CASE-7 (High) is assigned to Blue Team: Credential dumping on web-01. Turn off in User Settings > Notification Settings.",
    );

    const approval: ReturnType<typeof buildApprovalRequestedMessage> =
      buildApprovalRequestedMessage({
        facts,
        playbookName: "Contain",
        stepDescription: "step 3 (Suspend the user in Okta)",
        startedBy: "By hand",
        isOnCase: true,
      });
    expect(approval.pushTitle).toBe("Approval needed: Contain");
    expect(approval.templateType).toBe(
      EmailTemplateType.SecurityPlaybookApprovalRequested,
    );
    expect(approval.forceImmediate).toBe(true);
  });

  test("entities, steps and triggers read as people say them", () => {
    expect(
      describeEntities(
        Array.from({ length: 12 }, (_value: unknown, index: number) => {
          return { type: SecurityEntityType.User, value: `u${index}` };
        }),
      ),
    ).toBe(
      "u0 (User), u1 (User), u2 (User), u3 (User), u4 (User), u5 (User), u6 (User), u7 (User), u8 (User), u9 (User), and 2 more",
    );
    expect(describeStep(4, undefined)).toBe("step 4");
    expect(describeRunTrigger(SecurityPlaybookTrigger.DetectionAdded)).toBe(
      "Automatically, for a new detection",
    );
    expect(describeRunTrigger(SecurityPlaybookTrigger.Manual)).toBe("By hand");
  });

  test("only the setup test's address marks the setup test's case", () => {
    expect(
      isSetupTestCase({
        groupingKey: securityCaseGroupingKey({
          groupValue: SETUP_TEST_SOURCE_IP,
          fingerprint: "",
        }),
      }),
    ).toBe(true);
    expect(isSetupTestCase({ groupingKey: "entity:198.51.100.7" })).toBe(false);
    expect(isSetupTestCase({})).toBe(false);
  });
});
