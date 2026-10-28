import Queue from "../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../Server/Services/SecurityCaseTaskService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import { securityCaseGroupingKey } from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityCaseNotifications, {
  SECURITY_CASE_NOTIFICATION_JOB,
  SecurityCaseMessage,
  SecurityCaseMessageFacts,
  SecurityCaseNotificationKind,
  buildTargetAlertMessage,
  buildTaskAssignedMessage,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Red, Red500, Yellow500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SETUP_TEST_SOURCE_IP } from "../../../../Types/SecurityEvent/SecuritySetupTest";
import Timezone from "../../../../Types/Timezone";
import { SecurityCaseNotificationChoiceKind } from "../../../../Utils/SecurityCase/SecurityCaseNotificationPriority";
import {
  SecurityCaseTarget,
  SecurityCaseTargetAlertKind,
} from "../../../../Utils/SecurityCase/SecurityCaseTargets";
import { getJestSpyOn } from "../../../Spy";
import {
  buildDefaultTestPrioritiesWithTargets,
  testPriorityId,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What people are told when a security case is about to miss a response
 * target, or misses it (SecurityCaseTargetCheck queues it), and when a task
 * on a case is handed to them (SecurityCaseTaskService) - and who.
 *
 *   - The words, on every channel: which target, how long it was, how much
 *     is left or that it passed, when it is due in the reader's own time,
 *     why they are the one told. Never held back: a deadline.
 *   - A target alert goes to the people on the case - its assignee, its
 *     team's members - and, when nobody is, to the people told about cases
 *     at its priority; only to people who can read the case; never when the
 *     case was taken on, contained, closed or moved meanwhile.
 *   - A task goes to the person it was handed to, while it is still theirs
 *     and still to do, and never to whoever handed it to themselves.
 *
 * The database is a small in-memory project behind the services' methods;
 * the permission check is the real one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TASK_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const BLUE_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/project/security-events/cases/case";
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

interface Member {
  id: ObjectID;
  name: string;
  email: string;
  permissions: Array<Permission>;
  teamIds: Array<string>;
  limitedToOtherLabels?: boolean | undefined;
  // Their New Security Case setting.
  setting?: Partial<UserNotificationSetting> | undefined;
  timezone?: Timezone | undefined;
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
let task: SecurityCaseTask | null;
let sent: Array<{
  userId: string;
  eventType: string;
  subject: string;
  data: JSONObject;
}>;
let feedItems: Array<JSONObject>;
let channelPosts: Array<JSONObject>;
let queued: Array<{ jobName: string; data: JSONObject; options: JSONObject }>;

// A Critical case, opened at NOW, nobody on it: acknowledge due at 15, contain at 240.
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
  model.createdAt = NOW;
  model.acknowledgeDueAt = at(15);
  model.containDueAt = at(240);
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
            return { _type: "UserPermission", permission, labelIds: [] };
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

function toUser(person: Member): User {
  const user: User = new User();
  user.name = person.name as never;
  user.email = person.email as never;

  if (person.timezone) {
    user.timezone = person.timezone;
  }

  return user;
}

beforeEach(() => {
  jest.useFakeTimers({ now: at(13), doNotFake: ["nextTick", "setImmediate"] });

  stubSecurityCaseValues({
    priorities: buildDefaultTestPrioritiesWithTargets(),
  });
  members = [];
  securityCase = caseModel();
  task = null;
  sent = [];
  feedItems = [];
  channelPosts = [];
  queued = [];

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async (args: unknown) => {
      const { props } = args as { props: DatabaseCommonInteractionProps };

      if (props.isRoot) {
        return securityCase;
      }

      const person: Member | undefined = findMember(props.userId);

      if (person?.limitedToOtherLabels) {
        throw new NotAuthorizedException("Not allowed to read this case.");
      }

      return securityCase;
    },
  );
  getJestSpyOn(SecurityCaseService, "getCaseLinkInDashboard").mockResolvedValue(
    URL.fromString(CASE_URL) as never,
  );
  getJestSpyOn(SecurityCaseTaskService, "findOneBy").mockImplementation(
    async () => {
      return task;
    },
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
          row.user = toUser(person);
          return row;
        });
    },
  );
  getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (args: unknown) => {
      const person: Member | undefined = findMember(
        (args as { id: ObjectID }).id,
      );

      return person ? toUser(person) : null;
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
  ).mockResolvedValue(undefined as never);
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

    return person
      ? propsFor(person)
      : ({
          userId: (args as { userId: ObjectID }).userId,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: {},
        } as unknown as DatabaseCommonInteractionProps);
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
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function sentTo(): Array<string> {
  return sent.map((item: { userId: string }): string => {
    return findMember(item.userId)?.name || item.userId;
  });
}

const FACTS: SecurityCaseMessageFacts = {
  caseId: CASE_ID,
  projectId: PROJECT_ID,
  number: "CASE-12",
  title: "Brute force against admin",
  priority: "Critical",
  priorityColor: Red,
  isCritical: true,
  status: "New",
  source: "Detection Rule",
  assignee: "Unassigned",
  entities: [{ type: SecurityEntityType.IpAddress, value: "198.51.100.7" }],
  mitreTactics: ["TA0006"],
  detectionCount: 1,
  projectName: "Acme",
  url: CASE_URL,
  descriptionHtml: "<p>Ten failed sign-ins in a minute.</p>",
};

describe("what a target alert says", () => {
  function message(
    target: SecurityCaseTarget,
    alertKind: SecurityCaseTargetAlertKind,
    extra: Partial<Parameters<typeof buildTargetAlertMessage>[0]> = {},
  ): SecurityCaseMessage {
    return buildTargetAlertMessage({
      facts: FACTS,
      target,
      alertKind,
      dueAt: target === SecurityCaseTarget.Acknowledge ? at(15) : at(240),
      targetInMinutes: target === SecurityCaseTarget.Acknowledge ? 15 : 240,
      now: target === SecurityCaseTarget.Acknowledge ? at(12) : at(192),
      audience: { isOnCase: true },
      ...extra,
    });
  }

  test("about to miss the acknowledge target: how long it was, how long is left, never held back", () => {
    const sentMessage: SecurityCaseMessage = message(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.AtRisk,
    );

    expect(sentMessage.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
    );
    expect(sentMessage.templateType).toBe(
      EmailTemplateType.SecurityCaseTargetDue,
    );
    expect(sentMessage.subject).toBe(
      "[CASE-12] About to miss its acknowledge target: Brute force against admin",
    );
    // The heading says what happened, as the push does; the case's title is the first row.
    expect(sentMessage.emailVars["emailTitle"]).toBe(
      "CASE-12 is about to miss its acknowledge target",
    );
    expect(sentMessage.emailVars["emailTitle"]).toBe(sentMessage.pushTitle);
    expect(sentMessage.emailVars["leadSentence"]).toBe(
      "Nobody has taken this Critical security case on yet, and its acknowledge target is due in 3 minutes.",
    );
    expect(sentMessage.emailVars["targetText"]).toBe(
      "Acknowledge within 15 minutes",
    );
    expect(sentMessage.emailVars["caseTitle"]).toBe(FACTS.title);
    expect(sentMessage.emailVars["caseViewLink"]).toBe(CASE_URL);
    expect(sentMessage.smsText).toContain(
      "Security case CASE-12 (Critical) is about to miss its acknowledge target, 3 minutes left: Brute force against admin.",
    );
    expect(sentMessage.callText).toContain(
      "is about to miss its acknowledge target, with 3 minutes left: Brute force against admin.",
    );
    expect(sentMessage.pushTitle).toBe(
      "CASE-12 is about to miss its acknowledge target",
    );
    expect(sentMessage.pushBody).toBe(
      "3 minutes left. Critical: Brute force against admin",
    );
    expect(sentMessage.pushType).toBe("security-case-target");
    expect(sentMessage.requireInteraction).toBe(true);
    expect(sentMessage.forceImmediate).toBe(true);
  });

  test("missed the acknowledge target", () => {
    const sentMessage: SecurityCaseMessage = message(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.Missed,
      { now: at(15) },
    );

    expect(sentMessage.subject).toBe(
      "[CASE-12] Missed its acknowledge target: Brute force against admin",
    );
    expect(sentMessage.emailVars["emailTitle"]).toBe(
      "CASE-12 missed its acknowledge target",
    );
    expect(sentMessage.emailVars["leadSentence"]).toBe(
      "Nobody has taken this Critical security case on, and it missed its acknowledge target of 15 minutes.",
    );
    expect(sentMessage.smsText).toContain(
      "Security case CASE-12 (Critical) missed its acknowledge target: Brute force against admin.",
    );
    expect(sentMessage.pushTitle).toBe("CASE-12 missed its acknowledge target");
    expect(sentMessage.pushBody).toBe("Critical: Brute force against admin");
    expect(sentMessage.forceImmediate).toBe(true);
  });

  test("about to miss, and missed, the contain target", () => {
    expect(
      message(SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.AtRisk)
        .emailVars["leadSentence"],
    ).toBe(
      "This Critical security case is not contained yet, and its contain target is due in 48 minutes.",
    );
    expect(
      message(SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.AtRisk)
        .emailVars["targetText"],
    ).toBe("Contain within 4 hours");
    expect(
      message(SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.Missed, {
        now: at(240),
      }).emailVars["leadSentence"],
    ).toBe(
      "This Critical security case is not contained yet, and it missed its contain target of 4 hours.",
    );
    expect(
      message(SecurityCaseTarget.Contain, SecurityCaseTargetAlertKind.Missed, {
        now: at(240),
      }).emailVars["emailTitle"],
    ).toBe("CASE-12 missed its contain target");
  });

  test("a priority without a target any more: the target is named without a length", () => {
    const sentMessage: SecurityCaseMessage = message(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.Missed,
      { targetInMinutes: null, now: at(15) },
    );

    expect(sentMessage.emailVars["targetText"]).toBe("Acknowledge");
    expect(sentMessage.emailVars["leadSentence"]).toBe(
      "Nobody has taken this Critical security case on, and it missed its acknowledge target.",
    );
  });

  test("never says nothing is left: at least a minute", () => {
    expect(
      message(
        SecurityCaseTarget.Acknowledge,
        SecurityCaseTargetAlertKind.AtRisk,
        {
          now: new Date(at(15).getTime() - 5 * 1000),
        },
      ).emailVars["leadSentence"],
    ).toContain("is due in 1 minute.");
  });

  test("the due time is written in the reader's own time zone", () => {
    const sentMessage: SecurityCaseMessage = message(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.AtRisk,
      { timezone: Timezone.AsiaKolkata },
    );

    expect(sentMessage.emailVars["dueTime"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: at(15),
        timezones: [Timezone.AsiaKolkata],
      }),
    );
  });

  test("why the reader is told: the case is theirs, their team's, or nobody's at their priority", () => {
    expect(
      message(
        SecurityCaseTarget.Acknowledge,
        SecurityCaseTargetAlertKind.AtRisk,
      ).emailVars["reasonSentence"],
    ).toBe(
      "This case is assigned to you. Change these emails in User Settings > Notification Settings.",
    );
    expect(
      message(
        SecurityCaseTarget.Acknowledge,
        SecurityCaseTargetAlertKind.AtRisk,
        {
          audience: { isOnCase: true, teamName: "Blue Team" },
        },
      ).emailVars["reasonSentence"],
    ).toBe(
      "You are on Blue Team, the team this case is assigned to. Change these emails in User Settings > Notification Settings.",
    );
    expect(
      message(
        SecurityCaseTarget.Acknowledge,
        SecurityCaseTargetAlertKind.AtRisk,
        {
          audience: {
            isOnCase: false,
            minimum: {
              name: "High",
              kind: SecurityCaseNotificationChoiceKind.AndAbove,
            },
          },
        },
      ).emailVars["reasonSentence"],
    ).toBe(
      "Nobody is on this case yet, and you are told about cases at your chosen priority: High and above. Change these emails in User Settings > Notification Settings.",
    );
  });
});

describe("what a task's assignee is told", () => {
  test("which task, on which case, by whom; the button opens the case's tasks", () => {
    const sentMessage: SecurityCaseMessage = buildTaskAssignedMessage({
      facts: FACTS,
      taskTitle: "Reset the admin password",
      assignedBy: "Maya Chen",
      tasksUrl: `${CASE_URL}/tasks`,
    });

    expect(sentMessage.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
    );
    expect(sentMessage.templateType).toBe(
      EmailTemplateType.SecurityCaseTaskAssigned,
    );
    expect(sentMessage.subject).toBe(
      "[CASE-12] Task for you: Reset the admin password",
    );
    expect(sentMessage.emailVars["emailTitle"]).toBe(
      "Task for you on security case CASE-12",
    );
    expect(sentMessage.emailVars["leadSentence"]).toBe(
      "Maya Chen assigned you a task on this Critical security case.",
    );
    expect(sentMessage.emailVars["taskTitle"]).toBe("Reset the admin password");
    expect(sentMessage.emailVars["caseViewLink"]).toBe(`${CASE_URL}/tasks`);
    expect(sentMessage.smsText).toContain(
      "Task for you on security case CASE-12: Reset the admin password.",
    );
    expect(sentMessage.pushTitle).toBe("Task for you on CASE-12");
    expect(sentMessage.pushBody).toBe("Reset the admin password");
    expect(sentMessage.pushType).toBe("security-case-task-assigned");
    // A Critical case's task is sent at once.
    expect(sentMessage.forceImmediate).toBe(true);
  });

  test("without who handed it over", () => {
    expect(
      buildTaskAssignedMessage({
        facts: { ...FACTS, isCritical: false, priority: "Medium" },
        taskTitle: "Pull the proxy logs",
        tasksUrl: `${CASE_URL}/tasks`,
      }).emailVars["leadSentence"],
    ).toBe("You have a task on this Medium security case.");
  });
});

describe("queueing", () => {
  test("a target alert is queued at once, with its target and kind", async () => {
    await SecurityCaseNotifications.targetAlert({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      target: SecurityCaseTarget.Contain,
      alertKind: SecurityCaseTargetAlertKind.Missed,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.jobName).toBe(SECURITY_CASE_NOTIFICATION_JOB);
    expect(queued[0]!.data).toEqual({
      kind: SecurityCaseNotificationKind.TargetAlert,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      target: SecurityCaseTarget.Contain,
      alertKind: SecurityCaseTargetAlertKind.Missed,
    });
    expect(queued[0]!.options["delayInMs"]).toBeUndefined();
  });

  test("a task handed to somebody is queued; handed to oneself, it is not", async () => {
    const assignee: Member = member("Ana", 1, [Permission.SecurityMember]);
    const handedBy: Member = member("Maya", 2, [Permission.SecurityMember]);

    await SecurityCaseNotifications.taskAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      taskId: TASK_ID,
      userId: assignee.id,
      actorUserId: handedBy.id,
    });
    await SecurityCaseNotifications.taskAssigned({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      taskId: TASK_ID,
      userId: assignee.id,
      actorUserId: assignee.id,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({
      kind: SecurityCaseNotificationKind.TaskAssigned,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      taskId: TASK_ID.toString(),
      userId: assignee.id.toString(),
      actorUserId: handedBy.id.toString(),
    });
  });

  test("a job with a target or kind it does not know is dropped", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];

    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.TargetAlert,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      target: "Resolve",
      alertKind: SecurityCaseTargetAlertKind.AtRisk,
    });
    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.TaskAssigned,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
    });

    expect(sent).toEqual([]);
  });
});

describe("who is told that a case is about to miss a target", () => {
  async function alert(
    target: SecurityCaseTarget = SecurityCaseTarget.Acknowledge,
    alertKind: SecurityCaseTargetAlertKind = SecurityCaseTargetAlertKind.AtRisk,
  ): Promise<void> {
    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.TargetAlert,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      target,
      alertKind,
    });
  }

  test("nobody on it: the people told about cases at its priority, who can read it - and the channels", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember]),
      member("Viewer", 3, [Permission.SecurityViewer]),
      member("Developer", 4, [Permission.ProjectMember]),
    ];

    await alert();

    expect(sentTo()).toEqual(["Owner", "Analyst", "Viewer"]);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
    );
    expect(sent[0]!.data["forceImmediate"]).toBe(true);
    expect(sent[0]!.data["securityCaseId"]).toEqual(CASE_ID);

    // Told as people watching the priority: the default, High and above.
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["reasonSentence"]).toContain(
      "your chosen priority: High and above",
    );

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 3 people that this case is about to miss its **acknowledge** target.",
    );
    expect(feedItems[0]!["eventType"]).toBe(
      SecurityCaseFeedEventType.Notification,
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Yellow500);

    expect(channelPosts).toHaveLength(1);
    // Named as every other channel post names it: the security case.
    expect(String(channelPosts[0]!["feedInfoInMarkdown"])).toContain(
      "⏰ **Security case is about to miss its acknowledge target**: 2 minutes left.",
    );
    expect(channelPosts[0]!["notificationText"]).toBe(
      "Security case CASE-12 is about to miss its acknowledge target: Brute force against admin",
    );
  });

  test("a watcher whose chosen priority the case does not reach is not told", async () => {
    securityCase = caseModel({
      securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Medium),
      acknowledgeDueAt: at(12 * 60),
    });
    jest.setSystemTime(at(12 * 60 - 60));
    members = [
      // The default, High and above: a Medium case is not theirs.
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember], {
        setting: {
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Medium,
          ),
          alertByEmail: true,
        },
      }),
    ];

    await alert();

    expect(sentTo()).toEqual(["Analyst"]);
  });

  test("a watcher who switched every New Security Case channel off is left out", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner], {
        setting: { alertByEmail: false, alertByPush: false },
      }),
      member("Analyst", 2, [Permission.SecurityMember]),
    ];

    await alert();

    expect(sentTo()).toEqual(["Analyst"]);
  });

  test("assigned to a person: only them, as the case's own", async () => {
    const analyst: Member = member("Analyst", 2, [Permission.SecurityMember]);
    members = [member("Owner", 1, [Permission.ProjectOwner]), analyst];
    securityCase = caseModel({
      assignedToUserId: analyst.id,
      acknowledgedAt: at(1),
    });
    jest.setSystemTime(at(200));

    await alert(SecurityCaseTarget.Contain);

    expect(sentTo()).toEqual(["Analyst"]);
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["reasonSentence"]).toContain("This case is assigned to you.");
  });

  test("in a team's queue: the team's members who can read it, as the team's", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember], {
        teamIds: [BLUE_TEAM_ID.toString()],
      }),
      member("Developer", 3, [Permission.ProjectMember], {
        teamIds: [BLUE_TEAM_ID.toString()],
      }),
    ];
    securityCase = caseModel({ assignedToTeamId: BLUE_TEAM_ID });

    await alert();

    expect(sentTo()).toEqual(["Analyst"]);
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["reasonSentence"]).toContain(
      "You are on Blue Team, the team this case is assigned to.",
    );
  });

  test("a role limited to other labels is never told", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember], {
        limitedToOtherLabels: true,
      }),
    ];

    await alert();

    expect(sentTo()).toEqual(["Owner"]);
  });

  test("missed: told again, in red, and the channels say it", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    jest.setSystemTime(at(16));

    await alert(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.Missed,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(
      "[CASE-12] Missed its acknowledge target: Brute force against admin",
    );
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 1 person that this case missed its **acknowledge** target.",
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Red500);
    expect(String(channelPosts[0]!["feedInfoInMarkdown"])).toContain(
      "🚨 **Security case missed its acknowledge target**",
    );
  });

  test("taken on since the check: nothing is said", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    securityCase = caseModel({ acknowledgedAt: at(12.5) });

    await alert();

    expect(sent).toEqual([]);
    expect(feedItems).toEqual([]);
    expect(channelPosts).toEqual([]);
  });

  test("closed since the check: nothing about containing it either", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    securityCase = caseModel({ acknowledgedAt: at(1), closedAt: at(100) });
    jest.setSystemTime(at(200));

    await alert(SecurityCaseTarget.Contain);

    expect(sent).toEqual([]);
  });

  test("an at-risk alert that arrives once the target has passed is not sent: the miss will be", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    jest.setSystemTime(at(16));

    await alert(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.AtRisk,
    );

    expect(sent).toEqual([]);
  });

  test("a miss whose due time moved later with the case's priority is not sent", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    securityCase = caseModel({ acknowledgeDueAt: at(24 * 60) });
    jest.setSystemTime(at(16));

    await alert(
      SecurityCaseTarget.Acknowledge,
      SecurityCaseTargetAlertKind.Missed,
    );

    expect(sent).toEqual([]);
  });

  test("the setup test's case tells nobody", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    securityCase = caseModel({
      groupingKey: securityCaseGroupingKey({
        groupValue: SETUP_TEST_SOURCE_IP,
        fingerprint: "",
      }),
    });

    await alert();

    expect(sent).toEqual([]);
  });

  test("the due time is written in each reader's own time zone", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner], {
        timezone: Timezone.AsiaKolkata,
      }),
    ];

    await alert();

    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["dueTime"]).toBe(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: at(15),
        timezones: [Timezone.AsiaKolkata],
      }),
    );
  });
});

describe("who is told about a task", () => {
  function taskModel(overrides: Partial<SecurityCaseTask> = {}): void {
    task = new SecurityCaseTask();
    task._id = TASK_ID.toString();
    task.title = "Reset the admin password";
    task.isDone = false;
    Object.assign(task, overrides);
  }

  async function handOver(
    userId: ObjectID,
    actorUserId?: ObjectID,
  ): Promise<void> {
    await SecurityCaseNotifications.runJob({
      kind: SecurityCaseNotificationKind.TaskAssigned,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      taskId: TASK_ID.toString(),
      userId: userId.toString(),
      ...(actorUserId ? { actorUserId: actorUserId.toString() } : {}),
    });
  }

  test("the person it was handed to, with the case's Tasks page to open", async () => {
    const ana: Member = member("Ana", 1, [Permission.SecurityMember]);
    const maya: Member = member("Maya", 2, [Permission.SecurityMember]);
    members = [ana, maya];
    taskModel({ assignedToUserId: ana.id });

    await handOver(ana.id, maya.id);

    expect(sentTo()).toEqual(["Ana"]);
    expect(sent[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
    );
    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;
    expect(vars["taskTitle"]).toBe("Reset the admin password");
    expect(vars["leadSentence"]).toBe(
      "Maya assigned you a task on this Critical security case.",
    );
    expect(vars["caseViewLink"]).toBe(`${CASE_URL}/tasks`);
    // The push opens the Tasks page too.
    expect(
      (sent[0]!.data["pushNotificationMessage"] as unknown as JSONObject)[
        "url"
      ],
    ).toBe(`${CASE_URL}/tasks`);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 1 person of the task **Reset the admin password**.",
    );
    // A task is the person's, not the channel's.
    expect(channelPosts).toEqual([]);
  });

  test("handed to oneself: not told", async () => {
    const ana: Member = member("Ana", 1, [Permission.SecurityMember]);
    members = [ana];
    taskModel({ assignedToUserId: ana.id });

    await handOver(ana.id, ana.id);

    expect(sent).toEqual([]);
  });

  test("handed on again since: the earlier assignee is not told", async () => {
    const ana: Member = member("Ana", 1, [Permission.SecurityMember]);
    const diego: Member = member("Diego", 2, [Permission.SecurityMember]);
    members = [ana, diego];
    taskModel({ assignedToUserId: diego.id });

    await handOver(ana.id);

    expect(sent).toEqual([]);
  });

  test("done since: not told", async () => {
    const ana: Member = member("Ana", 1, [Permission.SecurityMember]);
    members = [ana];
    taskModel({ assignedToUserId: ana.id, isDone: true });

    await handOver(ana.id);

    expect(sent).toEqual([]);
  });

  test("deleted since: not told", async () => {
    const ana: Member = member("Ana", 1, [Permission.SecurityMember]);
    members = [ana];
    task = null;

    await handOver(ana.id);

    expect(sent).toEqual([]);
  });

  test("somebody who cannot read the case is not told", async () => {
    const developer: Member = member("Developer", 1, [
      Permission.ProjectMember,
    ]);
    members = [developer];
    taskModel({ assignedToUserId: developer.id });

    await handOver(developer.id);

    expect(sent).toEqual([]);
  });
});
