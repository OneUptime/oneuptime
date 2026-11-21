import Queue from "../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../../Server/Services/SecurityCaseStepCheckService";
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
  buildStepRegressedMessage,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseStepCheck from "../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Red, Red500 } from "../../../../Types/BrandColors";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SETUP_TEST_SOURCE_IP } from "../../../../Types/SecurityEvent/SecuritySetupTest";
import Timezone from "../../../../Types/Timezone";
import { CHECK_BLOCK_REGRESSED } from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { getJestSpyOn } from "../../../Spy";
import {
  buildDefaultTestPriorities,
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
 * What people are told when a step of a case's Response Plan that OneUptime
 * saw done stops holding (#10340) - the address got through again, the
 * account is active again - and who: the people on the case, its assignee
 * and its team's members; when nobody is on it, the people told about
 * cases at its priority; only people who can read the case; at once, never
 * held back; and nothing when the step holds again by the time it is sent.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const BLUE_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/project/security-events/cases/case";
const STEP_KEY: string = "contain:block-ip:198.51.100.7";
const STEP_TITLE: string =
  "Block 198.51.100.7 at your firewall, WAF or load balancer.";

interface Member {
  id: ObjectID;
  name: string;
  permissions: Array<Permission>;
  teamIds: Array<string>;
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
    permissions,
    teamIds: [],
    ...extra,
  };
}

let members: Array<Member>;
let securityCase: SecurityCase;
let check: SecurityCaseStepCheck | null;
let sent: Array<{ userId: string; data: JSONObject }>;
let feedItems: Array<JSONObject>;
let queued: Array<{ jobName: string; data: JSONObject; options: JSONObject }>;

function caseModel(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.caseNumberWithPrefix = "CASE-12";
  model.title = "Path traversal attempts";
  model.description = "";
  model.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  model.securityCaseStatusId = testStatusId(SecurityCaseStage.Contained);
  model.source = SecurityDetectionSource.DetectionRule;
  model.entities = [
    { type: SecurityEntityType.IpAddress, value: "198.51.100.7" },
  ] as unknown as JSONArray;
  model.detectionCount = 1;
  model.groupingKey = "entity:198.51.100.7";
  model.createdAt = new Date("2026-11-17T19:00:00.000Z");
  Object.assign(model, overrides);
  return model;
}

function checkModel(state: SecurityCaseStepCheckState): SecurityCaseStepCheck {
  const model: SecurityCaseStepCheck = new SecurityCaseStepCheck();
  model._id = "dddddddd-dddd-4ddd-8ddd-000000000001";
  model.state = state;
  model.evidence = {
    sentence: {
      template: CHECK_BLOCK_REGRESSED,
      values: { address: "198.51.100.7" },
      times: { time: "2026-11-17T20:05:00.000Z" },
    },
    facts: [],
    links: [],
    data: { regressedAt: "2026-11-17T20:05:00.000Z" },
  } as unknown as JSONObject;
  return model;
}

function findMember(userId: unknown): Member | undefined {
  return members.find((person: Member): boolean => {
    return person.id.toString() === String(userId);
  });
}

function toUser(person: Member): User {
  const user: User = new User();
  user.name = person.name as never;
  user.email = `${person.name.toLowerCase()}@example.com` as never;
  if (person.timezone) {
    user.timezone = person.timezone;
  }
  return user;
}

beforeEach(() => {
  stubSecurityCaseValues({ priorities: buildDefaultTestPriorities() });
  members = [];
  securityCase = caseModel();
  check = checkModel(SecurityCaseStepCheckState.Regressed);
  sent = [];
  feedItems = [];
  queued = [];

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      return securityCase;
    },
  );
  getJestSpyOn(SecurityCaseService, "getCaseLinkInDashboard").mockResolvedValue(
    URL.fromString(CASE_URL) as never,
  );
  getJestSpyOn(SecurityCaseStepCheckService, "findOneBy").mockImplementation(
    async () => {
      return check;
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
  getJestSpyOn(UserNotificationSettingService, "findBy").mockResolvedValue(
    [] as never,
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
    sent.push({ userId: String(data["userId"]), data });
  });
  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: unknown) => {
    const person: Member | undefined = findMember(
      (args as { userId: ObjectID }).userId,
    );

    return {
      userId: (args as { userId: ObjectID }).userId,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: person
        ? {
            [PROJECT_ID.toString()]: {
              _type: "UserTenantAccessPermission",
              projectId: PROJECT_ID,
              permissions: [Permission.ProjectUser, ...person.permissions].map(
                (permission: Permission) => {
                  return { _type: "UserPermission", permission, labelIds: [] };
                },
              ),
            },
          }
        : {},
    } as unknown as DatabaseCommonInteractionProps;
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
  ).mockResolvedValue(undefined as never);
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
    return findMember(item.userId)?.name || item.userId;
  });
}

async function notify(): Promise<void> {
  await SecurityCaseNotifications.runJob({
    kind: SecurityCaseNotificationKind.StepRegressed,
    projectId: PROJECT_ID.toString(),
    securityCaseId: CASE_ID.toString(),
    stepKey: STEP_KEY,
    stepTitle: STEP_TITLE,
  });
}

const FACTS: SecurityCaseMessageFacts = {
  caseId: CASE_ID,
  projectId: PROJECT_ID,
  number: "CASE-12",
  title: "Path traversal attempts",
  priority: "Critical",
  priorityColor: Red,
  isCritical: true,
  status: "Contained",
  source: "Detection Rule",
  assignee: "Unassigned",
  entities: [{ type: SecurityEntityType.IpAddress, value: "198.51.100.7" }],
  mitreTactics: [],
  detectionCount: 1,
  projectName: "Acme",
  url: CASE_URL,
  descriptionHtml: "",
};

describe("what a step that stopped holding says", () => {
  const LINE: string =
    "198.51.100.7 got through again at 20:05: the block is not holding.";

  test("what OneUptime saw, and the step, on every channel - at once, never held back", () => {
    const message: SecurityCaseMessage = buildStepRegressedMessage({
      facts: FACTS,
      line: LINE,
      stepTitle: STEP_TITLE,
      isOnCase: true,
    });

    expect(message.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_STEP_REGRESSED_NOTIFICATION,
    );
    expect(message.templateType).toBe(
      EmailTemplateType.SecurityCaseStepRegressed,
    );
    expect(message.subject).toBe(`[CASE-12] A step stopped holding: ${LINE}`);
    expect(message.emailVars).toMatchObject({
      emailTitle: "A step stopped holding on CASE-12",
      evidenceLine: LINE,
      stepTitle: STEP_TITLE,
    });
    expect(String(message.emailVars["reasonSentence"])).toContain(
      "You are on this case.",
    );
    expect(message.smsText).toContain(LINE);
    expect(message.callText).toContain(LINE);
    expect(message.pushBody).toBe(LINE);
    expect(message.forceImmediate).toBe(true);
    expect(message.requireInteraction).toBe(true);
  });

  test("told as a watcher of the case's priority when nobody is on it", () => {
    expect(
      String(
        buildStepRegressedMessage({
          facts: FACTS,
          line: LINE,
          stepTitle: STEP_TITLE,
          isOnCase: false,
        }).emailVars["reasonSentence"],
      ),
    ).toContain("Nobody is on this case");
  });
});

describe("who is told", () => {
  test("assigned to a person: only them, at once, with the time in their own zone", async () => {
    const analyst: Member = member("Analyst", 2, [Permission.SecurityMember], {
      timezone: "Europe/Berlin" as Timezone,
    });
    members = [member("Owner", 1, [Permission.ProjectOwner]), analyst];
    securityCase = caseModel({ assignedToUserId: analyst.id });

    await notify();

    expect(sentTo()).toEqual(["Analyst"]);
    expect(sent[0]!.data["eventType"]).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_STEP_REGRESSED_NOTIFICATION,
    );
    expect(sent[0]!.data["forceImmediate"]).toBe(true);

    const vars: JSONObject = (
      sent[0]!.data["emailEnvelope"] as unknown as { vars: JSONObject }
    ).vars;

    // 20:05 UTC is 21:05 in Berlin.
    expect(String(vars["evidenceLine"])).toMatch(
      /^198\.51\.100\.7 got through again at .*21:05.*: the block is not holding\.$/,
    );
    expect(vars["stepTitle"]).toBe(STEP_TITLE);
    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🔔 Notified 1 person that a step of this case stopped holding.",
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Red500);
  });

  test("in a team's queue: the team's members who can read the case", async () => {
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

    await notify();

    expect(sentTo()).toEqual(["Analyst"]);
  });

  test("nobody on it: the people told about cases at its priority who can read it", async () => {
    members = [
      member("Owner", 1, [Permission.ProjectOwner]),
      member("Analyst", 2, [Permission.SecurityMember]),
      member("Developer", 3, [Permission.ProjectMember]),
    ];

    await notify();

    expect(sentTo()).toEqual(["Owner", "Analyst"]);
  });

  test("a step that holds again by the time it is sent is not news", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    check = checkModel(SecurityCaseStepCheckState.LooksDone);

    await notify();

    expect(sent).toEqual([]);
    expect(feedItems).toEqual([]);
  });

  test("the setup test's case notifies nobody", async () => {
    members = [member("Owner", 1, [Permission.ProjectOwner])];
    securityCase = caseModel({
      groupingKey: securityCaseGroupingKey({
        groupValue: SETUP_TEST_SOURCE_IP,
        fingerprint: "",
      }),
    });

    await notify();

    expect(sent).toEqual([]);
  });
});

describe("queued by the step checks", () => {
  test("goes on the worker's queue at once, as one job of its kind", async () => {
    await SecurityCaseNotifications.stepRegressed({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      stepKey: STEP_KEY,
      stepTitle: STEP_TITLE,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]!.jobName).toBe(SECURITY_CASE_NOTIFICATION_JOB);
    expect(queued[0]!.data).toEqual({
      kind: SecurityCaseNotificationKind.StepRegressed,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      stepKey: STEP_KEY,
      stepTitle: STEP_TITLE,
    });
  });
});
