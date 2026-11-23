import Queue from "../../../../Server/Infrastructure/Queue";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import AIRunService from "../../../../Server/Services/AIRunService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../../Server/Services/SecurityCaseStepCheckService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import SecurityCaseResponse from "../../../../Server/Utils/AI/Security/Response/SecurityCaseResponse";
import SecurityCaseResponseLook from "../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseLook";
import SecurityCaseTriage from "../../../../Server/Utils/AI/Security/SecurityCaseTriage";
import FeedPersonName from "../../../../Server/Utils/Feed/FeedPersonName";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import SecurityCaseAiHold from "../../../../Server/Utils/SecurityCase/SecurityCaseAiHold";
import SecurityCaseHandOff from "../../../../Server/Utils/SecurityCase/SecurityCaseHandOff";
import SecurityCaseNotifications, {
  SECURITY_CASE_NOTIFICATION_JOB,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStepCheck from "../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../Types/API/URL";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SecurityCaseAiHoldOutcome,
  SecurityCaseAiHoldSkip,
} from "../../../../Types/SecurityCase/SecurityCaseAiHold";
import SecurityCaseAiVerdict from "../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { NotificationRuleUpdateKind } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import { getJestSpyOn } from "../../../Spy";
import { testPriorityId, testStatusId } from "../../../Helpers/SecurityCaseValues";
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
 * ONEUPTIME AI RESPONDS FIRST, END TO END (#10353): with the setting on, a
 * new Medium scanner case, through the real code of every step - whether
 * it is held as it opens, the notice that waits, OneUptime AI's work, the
 * review that ends the hold, and the notice job the Worker runs, down to
 * what each person and each channel is sent. Only the database rows, the
 * queue and the last hop out are stand-ins.
 *
 * The project: a Project Owner who kept every default (told of High cases
 * and above), a security analyst who chose Medium and above, a Security
 * Admin who chose Low and above, and a developer who cannot read security
 * cases. Done when:
 *
 *   - a Medium scanner case that OneUptime AI contains and checks within
 *     the hold sends one summary to the case's channels, and alerts nobody;
 *   - a case it cannot finish reaches people at once, with what it did and
 *     why it stopped;
 *   - a case at the project's highest priority is never held.
 *
 * And none of it carries the triage's report, which is for the case's
 * readers alone (SubjectReadersOnlyGuard): the case's row holds one here,
 * and no post or notice may.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWNER_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001");
const ANALYST_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
);
const ADMIN_ID: ObjectID = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000003");
const DEVELOPER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000004",
);

const ADDRESS: string = "35.205.11.131";
const REPORT_SECRET: string =
  "The triage saw db-prod-7, which a team set apart, reach for the scanner.";

interface Person {
  id: ObjectID;
  name: string;
  email: string;
  permissions: Array<Permission>;
  // Their New Security Case setting's priority, when they chose one.
  minimum?: SecurityCasePriorityLevel | undefined;
}

const PEOPLE: Array<Person> = [
  {
    id: OWNER_ID,
    name: "Olivia Owner",
    email: "olivia@example.com",
    permissions: [Permission.ProjectOwner],
  },
  {
    id: ANALYST_ID,
    name: "Ana Analyst",
    email: "ana@example.com",
    permissions: [Permission.SecurityMember],
    minimum: SecurityCasePriorityLevel.Medium,
  },
  {
    id: ADMIN_ID,
    name: "Sam Admin",
    email: "sam@example.com",
    permissions: [Permission.SecurityAdmin],
    minimum: SecurityCasePriorityLevel.Low,
  },
  {
    id: DEVELOPER_ID,
    name: "Dev Eloper",
    email: "dev@example.com",
    permissions: [Permission.ProjectMember],
    minimum: SecurityCasePriorityLevel.Low,
  },
];

function person(id: unknown): Person | undefined {
  return PEOPLE.find((candidate: Person): boolean => {
    return candidate.id.toString() === String(id);
  });
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

let openedAt: Date;
let caseRow: Record<string, unknown>;
let actions: Array<SecurityCaseAiAction>;
let blocks: Array<SecurityBlock>;
let checks: Array<SecurityCaseStepCheck>;
let jobs: Array<JSONObject>;
let alerts: Array<{
  userId: string;
  eventType: string;
  vars: JSONObject;
  sms: string;
}>;
let posts: Array<{ markdown: string; kinds: Array<string> }>;
let feed: Array<string>;

function later(seconds: number): Date {
  return new Date(openedAt.getTime() + seconds * 1000);
}

function action(
  kind: SecurityCaseAiActionKind,
  status: SecurityCaseAiActionStatus,
  target?: string,
): SecurityCaseAiAction {
  const row: SecurityCaseAiAction = new SecurityCaseAiAction(
    ObjectID.generate(),
  );
  row.kind = kind;
  row.status = status;

  if (target) {
    row.target = target;
  }

  return row;
}

beforeEach(() => {
  openedAt = new Date(Date.now() - 2 * 60 * 1000);
  caseRow = {
    _id: CASE_ID.toString(),
    projectId: PROJECT_ID,
    caseNumberWithPrefix: "SEC-12",
    title: `Web scanner from ${ADDRESS}`,
    description: "Requests probing for known paths.",
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    groupingKey: `detection:scanner-${ADDRESS}`,
    createdAt: openedAt,
    securityCaseStatusId: testStatusId(SecurityCaseStage.New),
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Medium),
    detectionCount: 1,
    aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
    aiResponseState: SecurityCaseAiResponseState.Working,
    // For the case's readers only: no post or notice may carry it.
    aiTriageReport: REPORT_SECRET,
  };
  actions = [];
  blocks = [];
  checks = [];
  jobs = [];
  alerts = [];
  posts = [];
  feed = [];

  stubSecurityCaseValues();

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project(PROJECT_ID);
    project.name = "Acme";
    project.enableAi = true;
    project.enableAutomaticSecurityCaseTriage = true;
    project.enableAutomaticSecurityCaseResponse = true;
    project.enableSecurityCaseAiRespondsFirst = true;
    project.securityCaseAiHoldMinutes = 10;
    return project;
  });

  // The case's row: read whole, whatever is selected, so nothing it holds can hide.
  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      if (String(args.query["_id"]) !== CASE_ID.toString()) {
        return null;
      }

      const row: SecurityCase = new SecurityCase(CASE_ID);
      Object.assign(row, caseRow);
      return row;
    },
  );
  getJestSpyOn(SecurityCaseService, "findBy").mockResolvedValue([]);
  getJestSpyOn(SecurityCaseService, "countBy").mockResolvedValue(
    new PositiveNumber(0),
  );
  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async (args: { data: Record<string, unknown> }) => {
    Object.assign(caseRow, args.data);
  });
  getJestSpyOn(
    SecurityCaseService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (args: {
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }) => {
      for (const [column, expected] of Object.entries(args.expectedData)) {
        if (String(caseRow[column] ?? null) !== String(expected ?? null)) {
          return false;
        }
      }

      Object.assign(caseRow, args.data);
      return true;
    },
  );
  getJestSpyOn(SecurityCaseService, "getCaseLinkInDashboard").mockResolvedValue(
    URL.fromString(
      `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/security-events/cases/${CASE_ID.toString()}`,
    ),
  );

  getJestSpyOn(SecurityCaseResponse, "getNotStartedReason").mockResolvedValue(
    null,
  );
  getJestSpyOn(SecurityCaseTriage, "getNotStartedReason").mockResolvedValue(
    null,
  );
  getJestSpyOn(SecurityCaseResponseLook, "readPlan").mockImplementation(
    async () => {
      return {
        plan: {
          isContainmentVerified: checks.some(
            (check: SecurityCaseStepCheck): boolean => {
              return check.state === SecurityCaseStepCheckState.Verified;
            },
          ),
        } as never,
        matches: null,
        playbooks: [],
      };
    },
  );

  getJestSpyOn(AIRunService, "findOneBy").mockImplementation(async () => {
    const triage: AIRun = new AIRun();
    triage.status = AIRunStatus.Completed;
    triage.completedAt = later(20);
    return triage;
  });

  getJestSpyOn(SecurityCaseAiActionService, "findBy").mockImplementation(
    async () => {
      return actions;
    },
  );
  getJestSpyOn(SecurityCaseAiActionService, "countBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      return new PositiveNumber(
        actions.filter((row: SecurityCaseAiAction): boolean => {
          return row.status === args.query["status"];
        }).length,
      );
    },
  );
  getJestSpyOn(SecurityCaseAiActionService, "create").mockImplementation(
    async (args: { data: SecurityCaseAiAction }) => {
      actions.push(args.data);
      return args.data;
    },
  );
  getJestSpyOn(SecurityBlockService, "findBy").mockImplementation(async () => {
    return blocks;
  });
  getJestSpyOn(SecurityBlockDestinations, "findForProject").mockResolvedValue({
    destinations: [{ name: "Cloudflare" }] as never,
    failedProviders: [],
  });
  getJestSpyOn(SecurityCaseStepCheckService, "findBy").mockImplementation(
    async () => {
      return checks;
    },
  );
  getJestSpyOn(SecurityPlaybookRunService, "findBy").mockResolvedValue([]);

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (args: { feedInfoInMarkdown: string }) => {
    feed.push(args.feedInfoInMarkdown);
    return new SecurityCaseFeed();
  });

  getJestSpyOn(Queue, "addJob").mockImplementation(
    async (...args: Array<unknown>) => {
      if (args[2] === SECURITY_CASE_NOTIFICATION_JOB) {
        jobs.push(args[3] as JSONObject);
      }
    },
  );

  // The project's members, their settings and what each may read.
  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(async () => {
    return PEOPLE.map((member: Person): TeamMember => {
      const row: TeamMember = new TeamMember();
      row.userId = member.id;
      const user: User = new User(member.id);
      user.name = member.name;
      user.email = member.email as never;
      row.user = user;
      return row;
    });
  });
  getJestSpyOn(UserNotificationSettingService, "findBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      return PEOPLE.filter((member: Person): boolean => {
        return Boolean(member.minimum);
      }).map((member: Person): UserNotificationSetting => {
        const row: UserNotificationSetting = new UserNotificationSetting();
        row.userId = member.id;
        row.eventType = args.query["eventType"] as NotificationSettingEventType;
        row.minimumSecurityCasePriorityId = testPriorityId(member.minimum!);
        row.alertByEmail = true;
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
  ).mockImplementation(async (args: Record<string, unknown>) => {
    alerts.push({
      userId: String(args["userId"]),
      eventType: String(args["eventType"]),
      vars: (args["emailEnvelope"] as { vars: JSONObject }).vars,
      sms: String((args["smsMessage"] as { message: string }).message),
    });
  });
  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: { userId: ObjectID }) => {
    return propsFor(person(args.userId)!);
  });
  getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (args: { id: ObjectID }) => {
      const member: Person | undefined = person(args.id);

      if (!member) {
        return null;
      }

      const user: User = new User(member.id);
      user.name = member.name;
      user.email = member.email as never;
      return user;
    },
  );
  getJestSpyOn(FeedPersonName, "readNames").mockImplementation(
    async (args: { users: Array<User> }) => {
      return new Map<string, string>(
        args.users.map((user: User): [string, string] => {
          return [
            user.id!.toString().toLowerCase(),
            person(user.id)?.name || "",
          ];
        }),
      );
    },
  );

  getJestSpyOn(
    WorkspaceNotificationRuleService,
    "sendWorkspaceMarkdownNotification",
  ).mockImplementation(
    async (args: {
      feedInfoInMarkdown: string;
      workspaceNotification: { updateKinds: Array<string> };
    }) => {
      posts.push({
        markdown: args.feedInfoInMarkdown,
        kinds: args.workspaceNotification.updateKinds,
      });
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The Worker: every notice job queued so far, in order, and the ones those queue.
async function runQueuedJobs(): Promise<void> {
  while (jobs.length > 0) {
    await SecurityCaseNotifications.runJob(jobs.shift()!);
  }
}

// The case opens, as SecurityCaseService.onCreateSuccess does it: the hold first, then the notice.
async function openCase(): Promise<void> {
  await SecurityCaseAiHold.onCaseOpened({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    isOpenedByDetection: true,
    now: openedAt,
  });

  await SecurityCaseNotifications.caseReachedPriority({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
  });
}

// OneUptime AI takes the case and blocks the scanner, on its own (#10352).
function aiBlocksTheScanner(): void {
  caseRow["aiTookCaseAt"] = later(25);
  actions.push(
    action(SecurityCaseAiActionKind.TakeCase, SecurityCaseAiActionStatus.Done),
    action(
      SecurityCaseAiActionKind.BlockAddress,
      SecurityCaseAiActionStatus.Done,
      ADDRESS,
    ),
  );

  const block: SecurityBlock = new SecurityBlock(ObjectID.generate());
  block.value = ADDRESS;
  block.createdAt = later(40);
  block.expiresAt = new Date(later(40).getTime() + 24 * 60 * 60 * 1000);
  blocks.push(block);
}

function everythingSent(): string {
  return JSON.stringify({ alerts, posts });
}

describe("with OneUptime AI responding first", () => {
  test("a Medium scanner case it contains and checks within the hold sends one summary to its channels, and alerts nobody", async () => {
    await openCase();

    expect(caseRow["aiHoldOutcome"]).toBe(SecurityCaseAiHoldOutcome.Holding);

    // The notice queued as the case opened finds the case held: it waits.
    await runQueuedJobs();

    expect(alerts).toEqual([]);
    expect(posts).toEqual([]);

    aiBlocksTheScanner();

    // OneUptime's checks prove the block holds, and the case moves to Contained.
    const requests: SecurityCaseStepCheck = new SecurityCaseStepCheck();
    requests.stepKey = `${RESPONSE_STEP_KINDS.requests}:${ADDRESS}`;
    requests.state = SecurityCaseStepCheckState.Verified;
    checks.push(requests);
    caseRow["securityCaseStatusId"] = testStatusId(SecurityCaseStage.Contained);
    caseRow["containedAt"] = later(112);

    expect(
      await SecurityCaseAiHold.review({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        now: later(112),
      }),
    ).toBe(SecurityCaseAiHoldOutcome.Resolved);

    await runQueuedJobs();

    // Nobody alerted: not the analyst, the admin, or anyone else.
    expect(alerts).toEqual([]);

    // One summary, to the channels that post new cases.
    expect(posts).toHaveLength(1);
    expect(posts[0]!.kinds).toEqual([NotificationRuleUpdateKind.PriorityReached]);
    expect(posts[0]!.markdown).toContain(
      `OneUptime AI contained SEC-12 in 1m${NO_BREAK_SPACE}52s, so nobody was alerted.`,
    );
    expect(posts[0]!.markdown).toContain(
      `Blocked ${ADDRESS} at Cloudflare for 24${NO_BREAK_SPACE}hours.`,
    );
    expect(posts[0]!.markdown).toContain("Nothing reached the app");
    expect(posts[0]!.markdown).toContain("SEC-12");

    // The case's own timeline says what happened.
    expect(feed.join("\n")).toContain("Nobody had to be alerted.");

    // Told once: the notice is claimed, and a later rise is a rise.
    expect(caseRow["notifiedSecurityCasePriorityId"]).toEqual(
      testPriorityId(SecurityCasePriorityLevel.Medium),
    );
    expect(everythingSent()).not.toContain(REPORT_SECRET);
  });

  test("a case it cannot finish reaches people at once, with what it did and why it stopped", async () => {
    await openCase();
    await runQueuedJobs();

    aiBlocksTheScanner();
    // Accounts ask first: OneUptime AI waits for a person to approve one.
    actions.push(
      action(
        SecurityCaseAiActionKind.ContainAccount,
        SecurityCaseAiActionStatus.Asked,
        "k.morgan",
      ),
    );

    expect(
      await SecurityCaseAiHold.review({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        now: later(70),
      }),
    ).toBe(SecurityCaseAiHoldOutcome.NeedsApproval);

    await runQueuedJobs();

    // The people told about Medium cases: the analyst and the admin; the owner hears of High and above.
    expect(
      alerts
        .map((alert: { userId: string }): string => {
          return alert.userId;
        })
        .sort(),
    ).toEqual([ANALYST_ID.toString(), ADMIN_ID.toString()].sort());

    for (const alert of alerts) {
      expect(alert.eventType).toBe(
        NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      );
      expect(String(alert.vars["leadSentence"])).toContain(
        "OneUptime AI responded first and is waiting for approval to contain the account k.morgan.",
      );
      expect(alert.vars["aiHoldReason"]).toBe(
        "OneUptime AI responded first and is waiting for approval to contain the account k.morgan.",
      );
      expect(alert.vars["aiHoldDone"]).toBe(
        `Took the case. Blocked ${ADDRESS} for 24 hours.`,
      );
      expect(alert.sms).toContain("waiting for approval");
    }

    // The channels: the new case, why now and what was done - posted where OneUptime AI's hand-offs are, too.
    expect(posts).toHaveLength(1);
    expect(posts[0]!.kinds).toEqual([
      NotificationRuleUpdateKind.PriorityReached,
      NotificationRuleUpdateKind.AI,
    ]);
    expect(posts[0]!.markdown).toContain("**New Medium security case.**");
    expect(posts[0]!.markdown).toContain(
      `Already done: Took the case. Blocked ${ADDRESS} for 24 hours.`,
    );
    expect(everythingSent()).not.toContain(REPORT_SECRET);
  });

  test("OneUptime AI's own hand-off sends what was held once, with its reason - not a second notice of its own", async () => {
    await openCase();
    await runQueuedJobs();
    aiBlocksTheScanner();

    expect(
      await SecurityCaseHandOff.handToPeople({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        reason: SecurityCaseHandOffReason.DidNotHold,
      }),
    ).toBe(true);
    expect(caseRow["aiHoldOutcome"]).toBe(SecurityCaseAiHoldOutcome.HandedOff);

    await runQueuedJobs();

    // One notice each, the new case's, with the hand-off's reason.
    expect(alerts).toHaveLength(2);

    for (const alert of alerts) {
      expect(alert.eventType).toBe(
        NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      );
      expect(String(alert.vars["aiHoldReason"])).toContain(
        "A step OneUptime AI took does not hold",
      );
    }

    expect(posts).toHaveLength(1);
    expect(everythingSent()).not.toContain(REPORT_SECRET);
  });

  test("Page now alerts people at once, naming who pressed it - who is not told", async () => {
    await openCase();
    await runQueuedJobs();

    expect(
      await SecurityCaseAiHold.pageNow({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: ANALYST_ID,
      }),
    ).toBe(true);

    await runQueuedJobs();

    expect(
      alerts.map((alert: { userId: string }): string => {
        return alert.userId;
      }),
    ).toEqual([ADMIN_ID.toString()]);
    expect(alerts[0]!.vars["aiHoldReason"]).toBe("Ana Analyst pressed Page now.");
    expect(posts[0]!.kinds).toEqual([NotificationRuleUpdateKind.PriorityReached]);
  });

  test("a person taking the case has it: nobody else is alerted, and the channels hear of the new case", async () => {
    await openCase();
    await runQueuedJobs();

    await SecurityCaseHandOff.handToPeople({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      reason: SecurityCaseHandOffReason.TakenOver,
      byUserId: ANALYST_ID,
    });

    expect(caseRow["aiHoldOutcome"]).toBe(
      SecurityCaseAiHoldOutcome.TakenByPerson,
    );

    await runQueuedJobs();

    expect(alerts).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.markdown).toContain(
      "Ana Analyst took the case while OneUptime AI was on it, so nobody else was alerted.",
    );
  });

  test("the hold time running out alerts people, saying so", async () => {
    await openCase();
    await runQueuedJobs();
    caseRow["aiHoldUntil"] = later(600);

    expect(
      await SecurityCaseAiHold.review({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        now: later(600),
      }),
    ).toBe(SecurityCaseAiHoldOutcome.TimeRanOut);

    await runQueuedJobs();

    expect(alerts).toHaveLength(2);
    expect(String(alerts[0]!.vars["aiHoldReason"])).toContain(
      `did not finish within 10${NO_BREAK_SPACE}minutes`,
    );
  });

  test("a case at the project's highest priority is never held: people are told as always", async () => {
    caseRow["securityCasePriorityId"] = testPriorityId(
      SecurityCasePriorityLevel.Critical,
    );

    expect(
      (
        await SecurityCaseAiHold.onCaseOpened({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          isOpenedByDetection: true,
          now: openedAt,
        })
      ).skip,
    ).toBe(SecurityCaseAiHoldSkip.HighestPriority);
    expect(caseRow["aiHoldOutcome"]).toBeUndefined();

    await SecurityCaseNotifications.caseReachedPriority({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });
    await runQueuedJobs();

    // Everyone who reads cases at Critical: the owner, the analyst and the admin.
    expect(
      alerts
        .map((alert: { userId: string }): string => {
          return alert.userId;
        })
        .sort(),
    ).toEqual(
      [OWNER_ID.toString(), ANALYST_ID.toString(), ADMIN_ID.toString()].sort(),
    );

    for (const alert of alerts) {
      expect(alert.vars["aiHoldReason"]).toBeUndefined();
    }

    expect(posts).toHaveLength(1);
    expect(posts[0]!.markdown).toContain("New Critical security case");
  });

  test("a held case's notice, sent as it opened, and its hold's end send it once between them", async () => {
    await openCase();
    aiBlocksTheScanner();
    actions.push(
      action(
        SecurityCaseAiActionKind.ContainAccount,
        SecurityCaseAiActionStatus.Asked,
        "k.morgan",
      ),
    );

    await SecurityCaseAiHold.review({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      now: later(70),
    });

    // Both jobs run after the hold ended: the one queued as the case opened, and the hold's.
    expect(jobs).toHaveLength(2);

    await runQueuedJobs();

    expect(alerts).toHaveLength(2);
    expect(posts).toHaveLength(1);
  });
});
