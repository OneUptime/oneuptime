import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../../Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../../Server/Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import {
  FEED_INVITEE_UNNAMED,
  FEED_NOBODY_NAMED,
} from "../../../../Server/Utils/Feed/FeedPersonName";
import logger from "../../../../Server/Utils/Logger";
import SecurityCaseNotifications, {
  SecurityCaseMessageFacts,
  SecurityCaseRecipient,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import {
  FEED_MEMBER_CASES,
  FEED_PERSON_CASES,
  FeedPersonCase,
  expectNoAddressIn,
  feedPersonAccount,
  nameAsEveryChatShowsIt,
  renderInEveryChat,
  stubInvitations,
} from "../../../Helpers/FeedPersonCases";
import {
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
 * WHAT A SECURITY CASE'S NOTIFICATIONS SAY OF PEOPLE: NEVER AN ADDRESS
 * (#10681).
 *
 * Every message about a case - its Slack, Microsoft Teams and Mattermost
 * channel posts, the emails, texts and calls to each person told - names
 * whom it is assigned to, and the case's feed lists who was told. People
 * outside the project can read a channel, the feed is read through the API
 * and workflows, and an email to the people on a case is read by each of
 * them. They named the assignee themselves - someone only invited by the
 * address they were invited at when no name was typed, a member with no
 * name by their address - put every person's address after their name in
 * the list of who was told, and said who assigned a case, handed on a task
 * or started a playbook by their address when they had no name.
 *
 * Now every person is named through FeedPersonName, as every feed entry and
 * channel line is. The notifications' real code runs; the database's rows
 * - the project's people, their roles, the case, its run and its task - are
 * answered here, the permission check is the real one, and what leaves
 * OneUptime (the messages to people, the channel posts, the feed) is kept
 * to be read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10681aaa-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("10681aaa-0000-4000-8000-000000000002");
const RUN_ID: ObjectID = new ObjectID("10681aaa-0000-4000-8000-000000000003");
const TASK_ID: ObjectID = new ObjectID("10681aaa-0000-4000-8000-000000000004");
const BLUE_TEAM_ID: ObjectID = new ObjectID(
  "10681aaa-0000-4000-8000-000000000005",
);
// Maya works the case: assigns it, hands on tasks, runs playbooks.
const MAYA_ID: ObjectID = new ObjectID("10681aaa-0000-4000-8000-0000000000a1");
// Tom is on the Blue Team, which can read and approve.
const TOM_ID: ObjectID = new ObjectID("10681aaa-0000-4000-8000-0000000000a2");
// The person each test is about.
const PERSON_ID: ObjectID = new ObjectID(
  "10681aaa-0000-4000-8000-0000000000a3",
);

const CASE_URL: string = "https://oneuptime.example/dashboard/case";

interface Person {
  account: User;
  // Their roles in the project: none for someone only invited.
  permissions: Array<Permission>;
  teamIds: Array<string>;
}

let people: Map<string, Person>;
let securityCase: SecurityCase;
let run: SecurityPlaybookRun | null;
let task: SecurityCaseTask | null;
let sent: Array<{ userId: string; data: JSONObject }>;
let feedItems: Array<JSONObject>;
let channelPosts: Array<JSONObject>;

function named(id: ObjectID, name: string): User {
  const user: User = new User(id);
  user.name = new Name(name);
  return user;
}

function caseModel(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.caseNumberWithPrefix = "CASE-12";
  model.title = "Brute force against admin";
  model.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  model.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  model.source = SecurityDetectionSource.DetectionRule;
  model.entities = [
    { type: SecurityEntityType.IpAddress, value: "198.51.100.7" },
  ] as unknown as JSONArray;
  model.detectionCount = 1;
  model.groupingKey = "entity:198.51.100.7";
  model.createdAt = new Date();
  Object.assign(model, overrides);
  return model;
}

/*
 * The person a test is about: their account, and - only invited - their
 * invitation, with no role in the project; a member is a Security Member
 * on the Blue Team.
 */
function setPerson(who: FeedPersonCase): void {
  people.set(PERSON_ID.toString(), {
    account: feedPersonAccount(PERSON_ID, who),
    permissions: who.invitation ? [] : [Permission.SecurityMember],
    teamIds: who.invitation ? [] : [BLUE_TEAM_ID.toString()],
  });

  stubInvitations(
    new Map<string, WithheldProfile>(
      who.invitation
        ? [[PERSON_ID.toString().toLowerCase(), who.invitation]]
        : [],
    ),
  );
}

function propsFor(
  userId: ObjectID,
  person: Person | undefined,
): DatabaseCommonInteractionProps {
  if (!person || person.permissions.length === 0) {
    return {
      userId,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {},
    } as unknown as DatabaseCommonInteractionProps;
  }

  return {
    userId,
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

beforeEach(() => {
  stubSecurityCaseValues();

  people = new Map<string, Person>([
    [
      MAYA_ID.toString(),
      {
        account: named(MAYA_ID, "Maya Chen"),
        permissions: [Permission.SecurityMember],
        teamIds: [],
      },
    ],
    [
      TOM_ID.toString(),
      {
        account: named(TOM_ID, "Tom Okafor"),
        permissions: [Permission.SecurityMember],
        teamIds: [BLUE_TEAM_ID.toString()],
      },
    ],
  ]);
  securityCase = caseModel();
  run = null;
  task = null;
  sent = [];
  feedItems = [];
  channelPosts = [];

  // Nobody is only invited unless a test says so.
  stubInvitations(new Map<string, WithheldProfile>());

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  jest.spyOn(SecurityCaseService, "findOneBy").mockImplementation((async () => {
    return securityCase;
  }) as never);
  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(URL.fromString(CASE_URL) as never);
  // The case's priority people were told at: claimed, as the first to tell.
  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme";
    return project;
  }) as never);
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team(BLUE_TEAM_ID);
    team.name = "Blue Team";
    return team;
  }) as never);

  // The project's members who accepted their invitation, or a team's.
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: JSONObject;
  }) => {
    const teamId: string | undefined = args.query["teamId"]
      ? String(args.query["teamId"])
      : undefined;
    const rows: Array<TeamMember> = [];

    for (const [id, person] of people.entries()) {
      if (person.permissions.length === 0) {
        continue;
      }

      if (teamId && !person.teamIds.includes(teamId)) {
        continue;
      }

      const row: TeamMember = new TeamMember();
      row.userId = new ObjectID(id);
      row.user = person.account;
      rows.push(row);
    }

    return rows;
  }) as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return people.get(args.id.toString())?.account || null;
  }) as never);
  jest
    .spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    )
    .mockImplementation((async (args: { userId: ObjectID }) => {
      return propsFor(args.userId, people.get(args.userId.toString()));
    }) as never);

  jest
    .spyOn(UserNotificationSettingService, "findBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(
      UserNotificationSettingService,
      "addSecurityCaseNotificationSettings",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: JSONObject) => {
      sent.push({ userId: String(data["userId"]), data });
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (data: JSONObject) => {
      feedItems.push(data);
    }) as never);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    )
    .mockImplementation((async (data: JSONObject) => {
      channelPosts.push(data);
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "findOneBy")
    .mockImplementation((async () => {
      return run;
    }) as never);
  jest
    .spyOn(SecurityCaseTaskService, "findOneBy")
    .mockImplementation((async () => {
      return task;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function emailVars(message: { data: JSONObject }): JSONObject {
  return (message.data["emailEnvelope"] as unknown as { vars: JSONObject })
    .vars;
}

function messageTo(userId: ObjectID): { userId: string; data: JSONObject } {
  const message: { userId: string; data: JSONObject } | undefined = sent.find(
    (candidate: { userId: string }): boolean => {
      return candidate.userId === userId.toString();
    },
  );

  expect(message).toBeDefined();

  return message!;
}

// Nothing that left OneUptime says an address in play.
function expectNothingSentHoldsAnAddress(): void {
  expectNoAddressIn(JSON.stringify(sent));
  expectNoAddressIn(JSON.stringify(feedItems));
  expectNoAddressIn(JSON.stringify(channelPosts));
}

describe.each(FEED_PERSON_CASES)(
  "$label, as whom a case is assigned to",
  (who: FeedPersonCase) => {
    test("the case's facts, which every message is written from, name them as every line does", async () => {
      setPerson(who);

      const facts: SecurityCaseMessageFacts =
        await SecurityCaseNotifications.getFacts(
          caseModel({ assignedToUserId: PERSON_ID }),
        );

      expect(facts.assignee).toBe(who.named);
      expectNoAddressIn(JSON.stringify(facts));
    });

    test("the channels' post and its Slack, Microsoft Teams and Mattermost text name them so, and no address", async () => {
      setPerson(who);
      securityCase = caseModel({
        assignedToUserId: PERSON_ID,
        assignedToTeamId: BLUE_TEAM_ID,
      });

      await SecurityCaseNotifications.notifyAssigned({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: PERSON_ID,
        teamId: BLUE_TEAM_ID,
        actorUserId: MAYA_ID,
      });

      expect(channelPosts).toHaveLength(1);

      const markdown: string = String(channelPosts[0]!["feedInfoInMarkdown"]);
      const notificationText: string = String(
        channelPosts[0]!["notificationText"],
      );

      expect(markdown).toContain(
        `👤 **Security case assigned to ${who.named}**`,
      );
      expect(markdown).toContain(`Assigned to **${who.named}**`);
      expect(notificationText).toBe(
        `Security case CASE-12 assigned to ${who.named}: Brute force against admin`,
      );

      for (const chat of renderInEveryChat(markdown, notificationText)) {
        expect(chat.posted).toContain(nameAsEveryChatShowsIt(who.named));
        expectNoAddressIn(chat.posted);
      }

      expectNothingSentHoldsAnAddress();
    });

    test("the email to everybody told names them as the case's assignee, and no message says an address", async () => {
      setPerson(who);
      securityCase = caseModel({
        assignedToUserId: PERSON_ID,
        assignedToTeamId: BLUE_TEAM_ID,
      });

      await SecurityCaseNotifications.notifyAssigned({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: PERSON_ID,
        teamId: BLUE_TEAM_ID,
        actorUserId: MAYA_ID,
      });

      // Tom is on the team; the person, when a member, is told too.
      expect(
        sent
          .map((message: { userId: string }): string => {
            return message.userId;
          })
          .sort(),
      ).toEqual(
        (who.invitation
          ? [TOM_ID.toString()]
          : [TOM_ID.toString(), PERSON_ID.toString()]
        ).sort(),
      );

      for (const message of sent) {
        expect(emailVars(message)["caseAssignee"]).toBe(who.named);
      }

      expectNothingSentHoldsAnAddress();
    });
  },
);

describe.each(FEED_PERSON_CASES)(
  "$label, in the case's list of who was told",
  (who: FeedPersonCase) => {
    /*
     * Somebody only invited is never told - they read no case - but the
     * list is named in one read of who of them is only invited
     * (FeedPersonName.readNames), so were they on it, it would name them
     * as every line does. Here they hold the role a member would.
     */
    test("the list names them by the name every line says, never with their address after it", async () => {
      setPerson(who);
      people.get(PERSON_ID.toString())!.permissions = [
        Permission.SecurityMember,
      ];

      await SecurityCaseNotifications.notifyPriorityReached({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      });

      expect(feedItems).toHaveLength(1);

      const listed: Array<string> = String(
        feedItems[0]!["moreInformationInMarkdown"],
      ).split("\n");

      expect(listed).toContain(`- ${who.named}`);
      expect(listed).toContain("- Maya Chen");
      expect(listed).toContain("- Tom Okafor");
      expectNothingSentHoldsAnAddress();
    });
  },
);

describe("the list of who was told", () => {
  test("whoever is only invited is read once for the whole list, in the case's project", async () => {
    setPerson(FEED_PERSON_CASES[5]!);
    const withheldIn: ReturnType<typeof stubInvitations> = stubInvitations(
      new Map<string, WithheldProfile>(),
    );

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(withheldIn).toHaveBeenCalledTimes(1);
    expect(withheldIn.mock.calls[0]![0].projectId).toBe(PROJECT_ID);
    expect([...withheldIn.mock.calls[0]![0].userIds].sort()).toEqual(
      [MAYA_ID, TOM_ID, PERSON_ID]
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort(),
    );
    expect(String(feedItems[0]!["moreInformationInMarkdown"])).toContain(
      "- ana.lee",
    );
  });

  test("when who is only invited cannot be read, each is Somebody: never a name that could be an address", async () => {
    setPerson(FEED_PERSON_CASES[5]!);
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("The database is not answering."));

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(String(feedItems[0]!["moreInformationInMarkdown"])).toBe(
      [FEED_NOBODY_NAMED, FEED_NOBODY_NAMED, FEED_NOBODY_NAMED]
        .map((name: string): string => {
          return `- ${name}`;
        })
        .join("\n"),
    );
    expectNothingSentHoldsAnAddress();
  });

  test("somebody only invited is never told, so never listed", async () => {
    setPerson(FEED_PERSON_CASES[0]!);

    await SecurityCaseNotifications.notifyPriorityReached({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(
      sent.map((message: { userId: string }): string => {
        return message.userId;
      }),
    ).not.toContain(PERSON_ID.toString());
    expect(String(feedItems[0]!["moreInformationInMarkdown"])).not.toContain(
      "Ivy",
    );
  });

  test("a recipient keeps the account it was read as, and no name built from it", async () => {
    setPerson(FEED_PERSON_CASES[5]!);

    const told: Array<SecurityCaseRecipient> =
      await SecurityCaseNotifications.notifyPriorityReached({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      });

    const person: SecurityCaseRecipient | undefined = told.find(
      (recipient: SecurityCaseRecipient): boolean => {
        return recipient.userId.equals(PERSON_ID);
      },
    );

    expect(person).toBeDefined();
    expect(person!.account.id?.toString()).toBe(PERSON_ID.toString());
    expect(Object.keys(person!).sort()).toEqual(["account", "userId"]);
  });
});

describe.each(FEED_MEMBER_CASES)(
  "$label, as who did something to a case",
  (who: FeedPersonCase) => {
    test("assigning it: the email to the people on it names them as every line names a member", async () => {
      people.get(MAYA_ID.toString())!.account = feedPersonAccount(MAYA_ID, who);
      securityCase = caseModel({ assignedToTeamId: BLUE_TEAM_ID });

      await SecurityCaseNotifications.notifyAssigned({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        teamId: BLUE_TEAM_ID,
        actorUserId: MAYA_ID,
      });

      expect(emailVars(messageTo(TOM_ID))["leadSentence"]).toBe(
        `${who.named} assigned this Critical security case to Blue Team, a team you are on.`,
      );
      expectNothingSentHoldsAnAddress();
    });

    test("handing over a task: the email names them so", async () => {
      people.get(MAYA_ID.toString())!.account = feedPersonAccount(MAYA_ID, who);
      task = new SecurityCaseTask();
      task._id = TASK_ID.toString();
      task.title = "Reset the admin password";
      task.isDone = false;
      task.assignedToUserId = TOM_ID;

      await SecurityCaseNotifications.notifyTaskAssigned({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        taskId: TASK_ID,
        userId: TOM_ID,
        actorUserId: MAYA_ID,
      });

      expect(emailVars(messageTo(TOM_ID))["leadSentence"]).toBe(
        `${who.named} assigned you a task on this Critical security case.`,
      );
      expectNothingSentHoldsAnAddress();
    });

    test("starting a playbook by hand: the approval's email to every approver names them so", async () => {
      people.get(MAYA_ID.toString())!.account = feedPersonAccount(MAYA_ID, who);
      securityCase = caseModel({ assignedToTeamId: BLUE_TEAM_ID });
      run = new SecurityPlaybookRun();
      run._id = RUN_ID.toString();
      run.status = SecurityPlaybookRunStatus.WaitingForApproval;
      run.playbookName = "Contain compromised host";
      run.trigger = SecurityPlaybookTrigger.Manual;
      run.triggeredByUserId = MAYA_ID;
      run.currentStepIndex = 0;
      run.steps = [
        {
          id: "s1",
          action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
          config: { connectionId: "66666666-6666-4666-8666-666666666666" },
          requiresApproval: true,
          continueOnFailure: false,
          onlyIfThreatIntelMatched: false,
        },
      ] as unknown as JSONArray;

      await SecurityCaseNotifications.notifyApprovalRequested({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        runId: RUN_ID,
      });

      expect(emailVars(messageTo(TOM_ID))["startedBy"]).toBe(who.named);
      expectNothingSentHoldsAnAddress();
    });
  },
);

describe("REGRESSION: the lines #10681 found", () => {
  test("an assignee only invited with no name typed is not named by the address they were invited at", async () => {
    setPerson(FEED_PERSON_CASES[1]!);

    const facts: SecurityCaseMessageFacts =
      await SecurityCaseNotifications.getFacts(
        caseModel({ assignedToUserId: PERSON_ID }),
      );

    expect(facts.assignee).toBe(FEED_INVITEE_UNNAMED);
  });

  test("a case assigned to somebody who is gone is said to be Unassigned, as it was", async () => {
    const facts: SecurityCaseMessageFacts =
      await SecurityCaseNotifications.getFacts(
        caseModel({ assignedToUserId: PERSON_ID }),
      );

    expect(facts.assignee).toBe("Unassigned");
  });
});
