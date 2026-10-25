import DatabaseConfig from "../../../../Server/DatabaseConfig";
import Queue from "../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectCallSMSConfigService from "../../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PushNotificationService from "../../../../Server/Services/PushNotificationService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService, {
  SECURITY_CASE_OPENED_BY_DETECTION_KEY,
} from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserEmailService from "../../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import EmailRollupWriter from "../../../../Server/Utils/EmailRollup/EmailRollupWriter";
import SecurityCaseNotifications, {
  SECURITY_CASE_NOTIFICATION_JOB,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityPlaybookEngine from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserEmail from "../../../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import WorkspaceNotificationRule from "../../../../Models/DatabaseModels/WorkspaceNotificationRule";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  buildPendingStepResults,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { getJestSpyOn } from "../../../Spy";
import {
  TEST_PRIORITY_IDS,
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

jest.mock("../../../../Server/Utils/Logger");

/*
 * SECURITY CASE NOTIFICATIONS, END TO END.
 *
 * From the change that starts it to what leaves OneUptime, through the real
 * code of every step between: the case service's hooks queue a job; the job
 * (what the Worker runs) picks the people; the user notification machinery
 * every other event uses reads each person's setting and sends their email
 * and push; the workspace rules match the case and post it to Slack. Only
 * the database rows, the queue and the last hop out (the email writer, the
 * push sender, the Slack API) are stand-ins.
 *
 * The project: a Project Owner who kept every default, a security analyst on
 * the Blue Team who chose Medium and above, and a developer who cannot see
 * security cases. One Slack rule posts High and Critical cases to #soc.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const BLUE_TEAM_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OWNER_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const ANALYST_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
);
const DEVELOPER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
);

interface Person {
  id: ObjectID;
  name: string;
  email: string;
  permissions: Array<Permission>;
  teamIds: Array<string>;
}

const PEOPLE: Array<Person> = [
  {
    id: OWNER_ID,
    name: "Olivia Owner",
    email: "olivia@example.com",
    permissions: [Permission.ProjectOwner],
    teamIds: [],
  },
  {
    id: ANALYST_ID,
    name: "Ana Analyst",
    email: "ana@example.com",
    permissions: [Permission.SecurityMember],
    teamIds: [BLUE_TEAM_ID.toString()],
  },
  {
    id: DEVELOPER_ID,
    name: "Dev Eloper",
    email: "dev@example.com",
    permissions: [Permission.ProjectMember],
    teamIds: [BLUE_TEAM_ID.toString()],
  },
];

function person(userId: unknown): Person | undefined {
  return PEOPLE.find((candidate: Person): boolean => {
    return candidate.id.toString() === String(userId);
  });
}

// Each person's notification settings rows, by event: what joining a project wrote.
let settingRows: Map<string, UserNotificationSetting>;
let securityCase: SecurityCase;
let run: SecurityPlaybookRun | null;
let jobs: Array<JSONObject>;
let emails: Array<{
  to: string;
  userId: string;
  eventType: string;
  subject: string;
  templateType: string;
  vars: JSONObject;
}>;
let pushes: Array<{ userId: string; title: string }>;
let slackPosts: Array<WorkspaceMessagePayload>;
let feed: Array<string>;

function settingKey(userId: unknown, eventType: unknown): string {
  return `${String(userId)}|${String(eventType)}`;
}

function seedDefaults(): void {
  for (const member of PEOPLE) {
    for (const eventType of [
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    ]) {
      const row: UserNotificationSetting = new UserNotificationSetting();
      row.userId = member.id;
      row.projectId = PROJECT_ID;
      row.eventType = eventType;
      row.alertByEmail = true;
      row.alertByPush = true;
      settingRows.set(settingKey(member.id, eventType), row);
    }
  }

  // The analyst hears about Medium cases too.
  settingRows.get(
    settingKey(
      ANALYST_ID,
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
    ),
  )!.minimumSecurityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Medium,
  );
}

function propsFor(member: Person): DatabaseCommonInteractionProps {
  return {
    userId: member.id,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectUser, ...member.permissions].map(
          (permission: Permission) => {
            return { _type: "UserPermission", permission, labelIds: [] };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function slackRule(): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.SecurityCase;
  rule.notificationRule = {
    _type: "SecurityCaseNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        // The project's own priorities, by id.
        value: [
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
        ],
      },
    ],
    shouldPostToExistingChannel: true,
    existingChannelNames: "soc",
  } as never;
  return rule;
}

beforeEach(() => {
  // The project's priorities and statuses: a new project's.
  stubSecurityCaseValues();
  settingRows = new Map();
  run = null;
  jobs = [];
  emails = [];
  pushes = [];
  slackPosts = [];
  feed = [];
  seedDefaults();

  securityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "CASE-12";
  securityCase.title = "Credential dumping on web-01";
  securityCase.description =
    "Detection rule **Credential dumping tool** matched.";
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Medium,
  );
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.source = SecurityDetectionSource.DetectionRule;
  securityCase.entities = [
    { type: SecurityEntityType.Host, value: "web-01" },
  ] as unknown as JSONArray;
  securityCase.mitreTactics = ["TA0006"];
  securityCase.detectionCount = 1;
  securityCase.groupingKey = "entity:web-01";
  securityCase.createdAt = new Date();
  securityCase.labels = [];

  // ---- The rows ----

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      return securityCase;
    },
  );
  getJestSpyOn(SecurityCaseService, "findOneById").mockImplementation(
    async () => {
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
  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockResolvedValue(undefined as never);

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project();
    project.name = "Acme";
    return project;
  });

  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(
    async (args: unknown) => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      const teamId: string | undefined = query["teamId"]
        ? String(query["teamId"])
        : undefined;

      return PEOPLE.filter((member: Person): boolean => {
        return !teamId || member.teamIds.includes(teamId);
      }).map((member: Person): TeamMember => {
        const row: TeamMember = new TeamMember();
        row.userId = member.id;
        const user: User = new User();
        user.name = member.name as never;
        user.email = new Email(member.email);
        row.user = user;
        return row;
      });
    },
  );

  getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (args: unknown) => {
      const member: Person | undefined = person((args as { id: ObjectID }).id);
      if (!member) {
        return null;
      }
      const user: User = new User();
      user.name = member.name as never;
      user.email = new Email(member.email);
      return user;
    },
  );

  getJestSpyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "Blue Team";
    return team;
  });

  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: unknown) => {
    return propsFor(person((args as { userId: ObjectID }).userId)!);
  });

  // The settings: read back for the people the case reaches, and per send.
  getJestSpyOn(UserNotificationSettingService, "findBy").mockImplementation(
    async (args: unknown) => {
      const eventType: string = String(
        (args as { query: JSONObject }).query["eventType"],
      );
      return Array.from(settingRows.values()).filter(
        (row: UserNotificationSetting): boolean => {
          return row.eventType === eventType;
        },
      );
    },
  );
  getJestSpyOn(UserNotificationSettingService, "findOneBy").mockImplementation(
    async (args: unknown) => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      // The membership check wraps the user id; the rows are members' anyway.
      const userId: string = String(
        (query["userId"] as unknown as { value?: unknown })?.value ??
          query["userId"],
      );
      const match: UserNotificationSetting | undefined = Array.from(
        settingRows.values(),
      ).find((row: UserNotificationSetting): boolean => {
        return (
          row.eventType === query["eventType"] &&
          (userId.includes(row.userId!.toString()) ||
            JSON.stringify(query["userId"]).includes(row.userId!.toString()))
        );
      });
      return match || null;
    },
  );
  // Every member has their rows already; nothing is created.
  getJestSpyOn(UserNotificationSettingService, "countBy").mockResolvedValue(
    new PositiveNumber(1) as never,
  );

  getJestSpyOn(UserEmailService, "findBy").mockImplementation(
    async (args: unknown) => {
      const member: Person | undefined = person(
        (args as { query: JSONObject }).query["userId"],
      );
      if (!member) {
        return [];
      }
      const address: UserEmail = new UserEmail();
      address.email = new Email(member.email);
      return [address];
    },
  );

  getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
    URL.fromString("https://oneuptime.example.com/dashboard") as never,
  );
  getJestSpyOn(
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
  ).mockResolvedValue(undefined as never);

  // ---- The last hop out ----

  getJestSpyOn(EmailRollupWriter, "sendOrRollup").mockImplementation(
    async (args: unknown) => {
      const data: {
        toEmail: Email;
        userId: ObjectID;
        eventType: string;
        emailEnvelope: {
          subject: string;
          templateType: string;
          vars: JSONObject;
        };
      } = args as never;
      emails.push({
        to: data.toEmail.toString(),
        userId: data.userId.toString(),
        eventType: data.eventType,
        subject: data.emailEnvelope.subject,
        templateType: data.emailEnvelope.templateType,
        vars: data.emailEnvelope.vars,
      });
    },
  );

  getJestSpyOn(
    PushNotificationService,
    "sendPushNotificationToUser",
  ).mockImplementation(
    async (userId: unknown, _projectId: unknown, message: unknown) => {
      pushes.push({
        userId: String(userId),
        title: (message as { title: string }).title,
      });
    },
  );

  getJestSpyOn(WorkspaceNotificationRuleService, "findBy").mockImplementation(
    async (args: unknown) => {
      const query: JSONObject = (args as { query: JSONObject }).query;
      return query["workspaceType"] === WorkspaceType.Slack &&
        query["eventType"] === NotificationRuleEventType.SecurityCase
        ? [slackRule()]
        : [];
    },
  );
  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "getProjectAuths",
  ).mockResolvedValue([] as never);
  getJestSpyOn(
    WorkspaceUtil,
    "postMessageToAllWorkspaceChannelsAsBot",
  ).mockImplementation(async (args: unknown) => {
    slackPosts.push(
      ...(
        args as { messagePayloadsByWorkspace: Array<WorkspaceMessagePayload> }
      ).messagePayloadsByWorkspace,
    );
    return [] as Array<WorkspaceSendMessageResponse>;
  });
  getJestSpyOn(WorkspaceNotificationLogService, "create").mockResolvedValue(
    undefined as never,
  );

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (args: unknown) => {
    feed.push(String((args as JSONObject)["feedInfoInMarkdown"]));
  });

  getJestSpyOn(SecurityPlaybookRunService, "findOneBy").mockImplementation(
    async () => {
      return run;
    },
  );

  // ---- The queue: what the Worker would be handed ----

  getJestSpyOn(Queue, "addJob").mockImplementation(
    async (
      _queue: unknown,
      _jobId: unknown,
      jobName: unknown,
      data: unknown,
    ) => {
      if (jobName === SECURITY_CASE_NOTIFICATION_JOB) {
        jobs.push(data as JSONObject);
      }
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// What the Worker does with every queued notification job.
async function runQueuedJobs(): Promise<void> {
  while (jobs.length > 0) {
    await SecurityCaseNotifications.runJob(jobs.shift()!);
  }
}

type CaseHooks = {
  onCreateSuccess: (
    onCreate: OnCreate<SecurityCase>,
    createdItem: SecurityCase,
  ) => Promise<SecurityCase>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SecurityCase>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<SecurityCase>>;
};

const caseHooks: CaseHooks = SecurityCaseService as unknown as CaseHooks;

async function openCaseFromDetection(): Promise<void> {
  await caseHooks.onCreateSuccess(
    {
      createBy: {
        data: new SecurityCase(),
        props: { isRoot: true },
        miscDataProps: { [SECURITY_CASE_OPENED_BY_DETECTION_KEY]: true },
      } as unknown as CreateBy<SecurityCase>,
      carryForward: undefined,
    },
    securityCase,
  );
}

async function changeCase(data: {
  change: JSONObject;
  userId?: ObjectID | undefined;
}): Promise<void> {
  const before: SecurityCase = securityCase;

  await caseHooks.onUpdateSuccess(
    {
      updateBy: {
        query: { _id: CASE_ID },
        data: data.change,
        props: data.userId
          ? { userId: data.userId, tenantId: PROJECT_ID }
          : { isRoot: true },
      } as unknown as UpdateBy<SecurityCase>,
      carryForward: new Map([
        [
          CASE_ID.toString(),
          {
            id: CASE_ID.toString(),
            projectId: PROJECT_ID,
            statusId: before.securityCaseStatusId?.toString(),
            priorityId: before.securityCasePriorityId?.toString(),
            verdict: undefined,
            assignedToUserId: before.assignedToUserId?.toString(),
            assignedToTeamId: before.assignedToTeamId?.toString(),
            acknowledgedAt: undefined,
            containedAt: undefined,
          },
        ],
      ]),
    },
    [CASE_ID],
  );

  // The write itself, as the database would have made it.
  Object.assign(securityCase, data.change);
}

function slackMarkdown(): Array<string> {
  return slackPosts.map((payload: WorkspaceMessagePayload): string => {
    return (payload.messageBlocks[0] as WorkspacePayloadMarkdown).text;
  });
}

describe("a security case from opening to approval", () => {
  test("a Medium case reaches the analyst who chose Medium, and stays out of #soc", async () => {
    await openCaseFromDetection();
    await runQueuedJobs();

    expect(
      emails.map((email: { to: string }) => {
        return email.to;
      }),
    ).toEqual(["ana@example.com"]);
    expect(emails[0]!.templateType).toBe(EmailTemplateType.SecurityCaseOpened);
    expect(emails[0]!.subject).toBe(
      "[CASE-12] New Medium security case: Credential dumping on web-01",
    );
    expect(emails[0]!.vars["caseViewLink"]).toBe(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/cases/${CASE_ID.toString()}`,
    );
    expect(pushes).toEqual([
      {
        userId: ANALYST_ID.toString(),
        title: "New Medium security case CASE-12",
      },
    ]);
    // The #soc rule is for High and Critical cases.
    expect(slackPosts).toEqual([]);
    expect(feed).toEqual(["🔔 Notified 1 person of this new **Medium** case."]);
  });

  test("rising to Critical reaches the owner, not the analyst again, and #soc hears of it", async () => {
    await openCaseFromDetection();
    await runQueuedJobs();
    emails = [];
    pushes = [];
    feed = [];

    // A more severe detection joined: the ingest raises the case as root.
    await changeCase({
      change: {
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Critical,
        ),
      },
    });
    await runQueuedJobs();

    expect(
      emails.map((email: { to: string }) => {
        return email.to;
      }),
    ).toEqual(["olivia@example.com"]);
    // People were told about it at Medium, so this is a rise, not a new case.
    expect(emails[0]!.subject).toBe(
      "[CASE-12] Security case is now Critical: Credential dumping on web-01",
    );
    expect(slackPosts).toHaveLength(1);
    expect(slackPosts[0]!.channelNames).toEqual(["soc"]);
    expect(slackMarkdown()[0]).toContain(
      "🚩 **Security case is now Critical**",
    );
    expect(slackMarkdown()[0]).toContain("Priority **Critical**");
    // The developer, who cannot see security cases, never heard a thing.
    expect(
      [...emails, ...pushes].some((item: { userId: string }) => {
        return item.userId === DEVELOPER_ID.toString();
      }),
    ).toBe(false);
  });

  test("moved to the Blue Team by the owner: its members who can see it are told, the owner is not", async () => {
    securityCase.securityCasePriorityId = testPriorityId(
      SecurityCasePriorityLevel.High,
    );
    securityCase.notifiedSecurityCasePriorityId = testPriorityId(
      SecurityCasePriorityLevel.High,
    );

    await changeCase({
      change: { assignedToTeamId: BLUE_TEAM_ID },
      userId: OWNER_ID,
    });
    await runQueuedJobs();

    expect(emails).toEqual([
      expect.objectContaining({
        to: "ana@example.com",
        eventType:
          NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
        templateType: EmailTemplateType.SecurityCaseAssigned,
        subject:
          "[CASE-12] Security case assigned to Blue Team: Credential dumping on web-01",
      }),
    ]);
    expect(emails[0]!.vars["leadSentence"]).toBe(
      "Olivia Owner assigned this High security case to Blue Team, a team you are on.",
    );
    expect(slackMarkdown()[0]).toContain(
      "👤 **Security case assigned to Blue Team**",
    );
  });

  test("a containment step waiting for approval asks the analyst on the case", async () => {
    securityCase.securityCasePriorityId = testPriorityId(
      SecurityCasePriorityLevel.Critical,
    );
    securityCase.notifiedSecurityCasePriorityId = testPriorityId(
      SecurityCasePriorityLevel.Critical,
    );
    securityCase.assignedToTeamId = BLUE_TEAM_ID;

    const steps: Array<SecurityPlaybookStep> = [
      {
        id: "contain",
        action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
        config: { connectionId: "66666666-6666-4666-8666-666666666666" },
        requiresApproval: true,
        continueOnFailure: false,
        onlyIfThreatIntelMatched: false,
      },
    ];

    run = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.playbookName = "Contain compromised host";
    run.status = SecurityPlaybookRunStatus.Queued;
    run.steps = steps as unknown as JSONArray;
    run.stepResults = buildPendingStepResults(steps) as unknown as JSONArray;
    run.currentStepIndex = 0;

    // The engine, as the Worker runs it: it stops at the step and asks.
    getJestSpyOn(SecurityPlaybookRunService, "findOneById").mockImplementation(
      async () => {
        return run;
      },
    );
    getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockImplementation(async (args: unknown) => {
      const { data, expectedData } = args as {
        data: JSONObject;
        expectedData: JSONObject;
      };
      if (run!.status !== expectedData["status"]) {
        return false;
      }
      run!.status = data["status"] as SecurityPlaybookRunStatus;
      return true;
    });
    // What the engine saves is what the job reads back, as from the database.
    getJestSpyOn(
      SecurityPlaybookRunService,
      "updateOneById",
    ).mockImplementation(async (args: unknown) => {
      Object.assign(run!, (args as { data: JSONObject }).data);
    });
    getJestSpyOn(
      SecurityPlaybookRunService,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined as never);

    // The step proposes the host the case is about (SecurityPlaybookTargets).
    getJestSpyOn(SecurityPlaybookTargets, "selectTargets").mockResolvedValue([
      {
        type: SecurityEntityType.Host,
        value: "web-01",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      },
    ] as never);

    await SecurityPlaybookEngine.executeRun(RUN_ID);
    expect(run.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);

    await runQueuedJobs();

    expect(emails).toEqual([
      expect.objectContaining({
        to: "ana@example.com",
        eventType:
          NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
        templateType: EmailTemplateType.SecurityPlaybookApprovalRequested,
        subject:
          "[CASE-12] Approval needed: Contain compromised host, step 1 (Contain the host in CrowdStrike)",
      }),
    ]);
    // The approver is told what the step would act on.
    expect(emails[0]!.vars["stepTargets"]).toBe("web-01");
    expect(pushes).toEqual([
      {
        userId: ANALYST_ID.toString(),
        title: "Approval needed: Contain compromised host",
      },
    ]);
    expect(slackMarkdown()[0]).toContain("⏸️ **Approval needed**");
  });
});
