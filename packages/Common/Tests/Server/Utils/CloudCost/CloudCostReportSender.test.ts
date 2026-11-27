import CloudCostGroup from "../../../../Models/DatabaseModels/CloudCostGroup";
import CloudCostReport from "../../../../Models/DatabaseModels/CloudCostReport";
import Project from "../../../../Models/DatabaseModels/Project";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import CloudCostGroupService from "../../../../Server/Services/CloudCostGroupService";
import CloudCostReportService, {
  CLOUD_COST_REPORT_OUTSIDE_API_KEY_REFUSAL,
  CLOUD_COST_REPORT_OUTSIDE_REFUSAL,
  Service as CloudCostReportServiceClass,
  getCloudCostReportIntervalProblem,
  readCloudCostReportChannelNames,
} from "../../../../Server/Services/CloudCostReportService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationSummaryService from "../../../../Server/Services/WorkspaceNotificationSummaryService";
import CloudCostReportBuilder from "../../../../Server/Utils/CloudCost/CloudCostReportBuilder";
import CloudCostReportSchedule, {
  CLOUD_COST_REPORTS_PER_TICK,
} from "../../../../Server/Utils/CloudCost/CloudCostReportSchedule";
import CloudCostReportSender, {
  CloudCostReportSendResult,
  isCloudCostReportDelivered,
} from "../../../../Server/Utils/CloudCost/CloudCostReportSender";
import UserLanguage from "../../../../Server/Utils/Notification/UserLanguage";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudCostReportContent,
  CloudCostReportPeriod,
  CloudCostReportScope,
  CloudCostReportSkipReason,
} from "../../../../Types/Cloud/CloudCostReport";
import { writeCloudCostReport } from "../../../../Types/Cloud/CloudCostReportWords";
import { EmailEnvelope } from "../../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { createTranslator } from "../../../../Types/Translator";
import UserType from "../../../../Types/UserType";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SENDING A COST REPORT (#11009), with every read and send stood in for:
 * who it goes to - its people, its teams' members, each group's team their
 * own section - each read as that person may read the costs, the same
 * figures built once per way of reading them; who is left out and why;
 * what goes to addresses and channels outside the project, as the Cloud
 * admin who set them may read it; and the schedule that claims each due
 * report once, whatever the replicas.
 */

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011009");
const REPORT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000f0001");
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000e0001");
const TEAM_FINANCE: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000a0001",
);
const TEAM_PAYMENTS: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000a0002",
);
const TEAM_SEARCH: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-0000000a0003",
);
const GROUP_PAYMENTS: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-00000000c001",
);
const GROUP_SEARCH: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-00000000c002",
);
const GROUP_SHARED: ObjectID = new ObjectID(
  "0192f1a0-1100-7000-8000-00000000c003",
);

const DUE: Date = new Date("2026-11-23T08:00:00.000Z");

function userOf(index: number, name: string): User {
  const user: User = new User();
  user.id = new ObjectID(
    `0192f1a0-1100-7000-8000-${String(index).padStart(12, "0")}`,
  );
  user.name = name as never;
  user.email =
    `${name.toLowerCase().replace(/\s+/g, ".")}@example.com` as never;
  return user;
}

const ALICE: User = userOf(1, "Alice");
const BOB: User = userOf(2, "Bob");
const CAROL: User = userOf(3, "Carol");
const DAN: User = userOf(4, "Dan");
const ERIN: User = userOf(5, "Erin");
const ADMIN: User = userOf(9, "Admin");

function propsOf(
  user: User,
  permissions: Array<Permission>,
  labelIds: Array<ObjectID> = [],
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    projectId: PROJECT,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds,
        isBlockPermission: false,
      };
    }),
  };

  return {
    tenantId: PROJECT,
    userId: user.id!,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT.toString()]: tenant },
  };
}

function reportOf(overrides: Partial<CloudCostReport> = {}): CloudCostReport {
  const report: CloudCostReport = new CloudCostReport();
  report.id = REPORT;
  report.projectId = PROJECT;
  report.name = "Weekly cloud costs by team";
  report.isEnabled = true;
  report.scope = CloudCostReportScope.AllAccounts;
  report.period = CloudCostReportPeriod.LastWeek;
  report.timezone = "Europe/Berlin" as never;
  report.recipientUsers = [];
  report.recipientTeams = [];
  report.emailAddresses = [];
  report.slackChannelNames = [];
  report.microsoftTeamsChannelNames = [];
  Object.assign(report, overrides);
  return report;
}

function teamOf(id: ObjectID): Team {
  const team: Team = new Team();
  team.id = id;
  return team;
}

function groupOf(
  id: ObjectID,
  name: string,
  teamId: ObjectID | undefined,
  isShared: boolean = false,
): CloudCostGroup {
  const group: CloudCostGroup = new CloudCostGroup();
  group.id = id;
  group.name = name;
  group.isShared = isShared;

  if (teamId) {
    group.teamId = teamId;
  }

  return group;
}

function contentFor(data: {
  props: DatabaseCommonInteractionProps;
  groupId?: ObjectID | undefined;
}): CloudCostReportContent {
  return {
    reportId: REPORT.toString(),
    reportName: "Weekly cloud costs by team",
    projectName: "Acme",
    scope: CloudCostReportScope.AllAccounts,
    period: CloudCostReportPeriod.LastWeek,
    start: "2026-11-16",
    lastDay: "2026-11-22",
    previousStart: "2026-11-09",
    previousLastDay: "2026-11-15",
    currency: "USD",
    basis: "amortized",
    section: {
      kind: data.groupId ? "group" : "summary",
      groupId: data.groupId?.toString(),
      name: data.groupId ? "Payments" : "",
      total: 1200,
      previousTotal: 1000,
      rises: [],
      falls: [],
      budgets: [],
      unusualDays: [],
    },
    otherCurrencies: [],
    costsUrl:
      "https://oneuptime.example/dashboard/p/cloud/costs?start=2026-11-16",
    csv: '"service","amount"\n"Amazon EC2","1200"\n',
    csvFileName:
      "cloud-costs-by-service-amortized-2026-11-16-to-2026-11-22.csv",
    readAt: DUE.toISOString(),
  };
}

// The stand-ins every send reads through, and what each was asked.
interface Stage {
  report: CloudCostReport;
  users: Map<string, User>;
  teams: Map<string, Array<User>>;
  groups: Array<CloudCostGroup>;
  permissions: Map<string, DatabaseCommonInteractionProps>;
  builds: Array<{ props: DatabaseCommonInteractionProps; groupId?: ObjectID }>;
  notifications: Array<{ userId: ObjectID; envelope: EmailEnvelope }>;
  mails: Array<EmailEnvelope & { toEmail?: { toString: () => string } }>;
  posts: Array<{ channel: string; workspaceType: string; teamId?: string }>;
  failingChannels: Map<string, string>;
  teamsTeamId: string | undefined;
}

let stage: Stage;

function setStage(report: CloudCostReport): void {
  stage = {
    report,
    users: new Map(
      [ALICE, BOB, CAROL, DAN, ERIN, ADMIN].map((user: User) => {
        return [user.id!.toString(), user];
      }),
    ),
    teams: new Map(),
    groups: [],
    permissions: new Map([
      [ALICE.id!.toString(), propsOf(ALICE, [Permission.ReadCloudResource])],
      [BOB.id!.toString(), propsOf(BOB, [Permission.ReadCloudResource])],
      [CAROL.id!.toString(), propsOf(CAROL, [Permission.CloudAdmin])],
      // Dan may read dashboards, not the cloud's costs.
      [DAN.id!.toString(), propsOf(DAN, [Permission.ReadDashboard])],
      [ERIN.id!.toString(), propsOf(ERIN, [Permission.ReadCloudResource])],
      [ADMIN.id!.toString(), propsOf(ADMIN, [Permission.CloudAdmin])],
    ]),
    builds: [],
    notifications: [],
    mails: [],
    posts: [],
    failingChannels: new Map(),
    teamsTeamId: "teams-team-1",
  };

  jest
    .spyOn(CloudCostReportService, "findOneById")
    .mockImplementation((async () => {
      return stage.report;
    }) as never);
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const project: Project = new Project();
    project.name = "Acme";
    return project;
  }) as never);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/dashboard"));
  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    return stage.users.get(data.id.toString()) || null;
  }) as never);
  jest
    .spyOn(TeamMemberService, "getUsersInTeams")
    .mockImplementation(async (teamIds: Array<ObjectID>) => {
      return teamIds.flatMap((id: ObjectID): Array<User> => {
        return stage.teams.get(id.toString()) || [];
      });
    });
  jest.spyOn(CloudCostGroupService, "findBy").mockImplementation((async () => {
    return stage.groups;
  }) as never);
  jest
    .spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    )
    .mockImplementation(async (data: { userId: ObjectID }) => {
      return (
        stage.permissions.get(data.userId.toString()) || {
          userId: data.userId,
          userType: UserType.User,
        }
      );
    });
  jest
    .spyOn(CloudCostReportBuilder, "build")
    .mockImplementation(
      async (request: {
        props: DatabaseCommonInteractionProps;
        groupId?: ObjectID | undefined;
      }) => {
        stage.builds.push({
          props: request.props,
          ...(request.groupId ? { groupId: request.groupId } : {}),
        });
        return contentFor(request);
      },
    );
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en");
  jest
    .spyOn(
      UserNotificationSettingService,
      "addCloudCostReportNotificationSettings",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
      emailEnvelope: EmailEnvelope;
    }) => {
      expect(data.eventType).toBe(
        NotificationSettingEventType.SEND_CLOUD_COST_REPORT_NOTIFICATION,
      );
      stage.notifications.push({
        userId: data.userId,
        envelope: data.emailEnvelope,
      });
    }) as never);
  jest.spyOn(MailService, "sendMail").mockImplementation((async (
    mail: EmailEnvelope,
  ) => {
    stage.mails.push(mail);
  }) as never);
  jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<{
        channelNames: Array<string>;
        workspaceType: WorkspaceType;
        teamId?: string;
      }>;
    }) => {
      const payload: {
        channelNames: Array<string>;
        workspaceType: WorkspaceType;
        teamId?: string;
      } = data.messagePayloadsByWorkspace[0]!;
      const channel: string = payload.channelNames[0]!;
      stage.posts.push({
        channel,
        workspaceType: payload.workspaceType,
        ...(payload.teamId ? { teamId: payload.teamId } : {}),
      });
      const failure: string | undefined = stage.failingChannels.get(channel);

      return [
        failure
          ? {
              errors: [
                { channel: { id: "C1", name: channel }, error: failure },
              ],
              threads: [],
            }
          : {
              errors: [],
              threads: [
                { channel: { id: "C1", name: channel }, threadId: "t1" },
              ],
            },
      ];
    }) as never);
  jest
    .spyOn(
      WorkspaceNotificationSummaryService as unknown as {
        getMicrosoftTeamsTeamOfSummary: () => Promise<unknown>;
      },
      "getMicrosoftTeamsTeamOfSummary",
    )
    .mockImplementation(async () => {
      return stage.teamsTeamId
        ? { teamId: stage.teamsTeamId }
        : { teamId: undefined, notPostedReason: "No team is named." };
    });
}

function send(): Promise<CloudCostReportSendResult> {
  return CloudCostReportSender.send({ reportId: REPORT, at: DUE });
}

function notified(): Array<string> {
  return stage.notifications.map(
    (entry: { userId: ObjectID; envelope: EmailEnvelope }): string => {
      return stage.users.get(entry.userId.toString())!.name!.toString();
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who a report goes to", () => {
  beforeEach(() => {
    setStage(
      reportOf({
        recipientUsers: [ALICE, DAN],
        recipientTeams: [teamOf(TEAM_FINANCE)],
      }),
    );
    // Finance: Bob, and Alice again.
    stage.teams.set(TEAM_FINANCE.toString(), [BOB, ALICE]);
  });

  test("its people and its teams' members, each once, through their notification settings", async () => {
    const result: CloudCostReportSendResult = await send();

    expect(notified()).toEqual(["Alice", "Bob"]);
    expect(result.people).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.start).toBe("2026-11-16");
    expect(result.lastDay).toBe("2026-11-22");
    expect(isCloudCostReportDelivered(result)).toBe(true);
  });

  test("one who may not read the project's costs is left out, saying why", async () => {
    const result: CloudCostReportSendResult = await send();

    expect(result.skipped).toEqual([
      { who: "Dan", reason: CloudCostReportSkipReason.MayNotRead },
    ]);
    expect(
      stage.notifications.some((entry: { userId: ObjectID }) => {
        return entry.userId.toString() === DAN.id!.toString();
      }),
    ).toBe(false);
  });

  test("each is read as they may read the costs, and those who read alike share one read", async () => {
    stage.permissions.set(
      BOB.id!.toString(),
      // Bob reads only what the prod label reaches.
      propsOf(
        BOB,
        [Permission.ReadCloudResource],
        [new ObjectID("0192f1a0-1100-7000-8000-0000000b0001")],
      ),
    );
    stage.report.recipientUsers = [ALICE, BOB, ERIN];
    stage.report.recipientTeams = [];

    await send();

    // Alice and Erin read alike: one build. Bob reads less: his own.
    expect(stage.builds).toHaveLength(2);
    expect(stage.builds[0]!.props.userId!.toString()).toBe(
      ALICE.id!.toString(),
    );
    expect(stage.builds[1]!.props.userId!.toString()).toBe(BOB.id!.toString());
    expect(notified()).toEqual(["Alice", "Bob", "Erin"]);
  });

  test("a send to one person who fails is said, and the others still get theirs", async () => {
    let calls: number = 0;
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: { userId: ObjectID }) => {
        calls++;

        if (data.userId.toString() === ALICE.id!.toString()) {
          throw new Error("The mail server is down.");
        }
      }) as never);

    const result: CloudCostReportSendResult = await send();

    expect(calls).toBe(2);
    expect(result.people).toBe(1);
    expect(result.errors).toEqual(["Alice: The mail server is down."]);
  });

  test("a report reaches at most 200 people", async () => {
    const many: Array<User> = [];

    for (let index: number = 100; index < 305; index++) {
      const user: User = userOf(index, `Person ${index}`);
      many.push(user);
      stage.users.set(user.id!.toString(), user);
      stage.permissions.set(
        user.id!.toString(),
        propsOf(user, [Permission.ReadCloudResource]),
      );
    }

    stage.report.recipientUsers = [];
    stage.report.recipientTeams = [teamOf(TEAM_FINANCE)];
    stage.teams.set(TEAM_FINANCE.toString(), many);

    const result: CloudCostReportSendResult = await send();

    expect(result.people).toBe(200);
    expect(
      result.skipped.filter((skip: { reason: string }) => {
        return skip.reason === CloudCostReportSkipReason.TooManyPeople;
      }),
    ).toHaveLength(5);
  });
});

describe("a cost view's report, a section for each group's team", () => {
  beforeEach(() => {
    setStage(
      reportOf({
        scope: CloudCostReportScope.CostView,
        cloudCostViewId: VIEW,
        isSentToGroupTeams: true,
        recipientUsers: [ALICE],
      }),
    );
    stage.groups = [
      groupOf(GROUP_PAYMENTS, "Payments", TEAM_PAYMENTS),
      groupOf(GROUP_SEARCH, "Search", TEAM_SEARCH),
      // A shared group's costs go to the others: it has no section.
      groupOf(GROUP_SHARED, "Shared", TEAM_FINANCE, true),
    ];
    stage.teams.set(TEAM_PAYMENTS.toString(), [BOB, ALICE, ERIN]);
    stage.teams.set(TEAM_SEARCH.toString(), [ERIN]);
    stage.teams.set(TEAM_FINANCE.toString(), [CAROL]);
  });

  test("each group's team gets its group's section; who gets the whole report gets no section too", async () => {
    const result: CloudCostReportSendResult = await send();

    expect(result.people).toBe(1);
    // Bob for Payments, Erin for Payments and for Search.
    expect(result.groupSections).toBe(3);
    expect(notified()).toEqual(["Alice", "Bob", "Erin", "Erin"]);
    expect(
      stage.builds.map((build: { groupId?: ObjectID }) => {
        return build.groupId?.toString() || "whole";
      }),
    ).toEqual(["whole", GROUP_PAYMENTS.toString(), GROUP_SEARCH.toString()]);
  });

  test("a section's email says whose group it is and why it came", async () => {
    await send();

    const bob: { envelope: EmailEnvelope } = stage.notifications.find(
      (entry: { userId: ObjectID }) => {
        return entry.userId.toString() === BOB.id!.toString();
      },
    )!;
    const report: Record<string, unknown> = bob.envelope.vars[
      "report"
    ] as Record<string, unknown>;

    expect(String(report["lead"])).toMatch(
      /^Your team's cost group, Payments, in the report Weekly cloud costs by team\. /,
    );
    expect(report["why"]).toBe(
      "You get this section because your team owns the Payments cost group in Acme. Turn cloud cost reports off in your notification settings.",
    );
  });

  test("without the setting, only the report's own people get it", async () => {
    stage.report.isSentToGroupTeams = false;

    const result: CloudCostReportSendResult = await send();

    expect(result.groupSections).toBe(0);
    expect(notified()).toEqual(["Alice"]);
  });
});

describe("addresses and channels outside the project", () => {
  beforeEach(() => {
    setStage(
      reportOf({
        emailAddresses: ["finance@example.org", "accountant@example.net"],
        slackChannelNames: ["#finops"],
        microsoftTeamsChannelNames: ["Cost reviews"],
        microsoftTeamsTeamName: "Finance",
        outsideRecipientsSetByUserId: ADMIN.id!,
      }),
    );
  });

  test("are sent the report as the Cloud admin who set them may read it", async () => {
    const result: CloudCostReportSendResult = await send();

    expect(result.addresses).toBe(2);
    expect(result.channels).toBe(2);
    expect(result.skipped).toEqual([]);
    expect(stage.builds).toHaveLength(1);
    expect(stage.builds[0]!.props.userId!.toString()).toBe(
      ADMIN.id!.toString(),
    );
    expect(
      stage.mails.map((mail: { toEmail?: { toString: () => string } }) => {
        return mail.toEmail!.toString();
      }),
    ).toEqual(["finance@example.org", "accountant@example.net"]);
    expect(stage.posts).toEqual([
      { channel: "#finops", workspaceType: WorkspaceType.Slack },
      {
        channel: "Cost reviews",
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: "teams-team-1",
      },
    ]);
  });

  test("an address's email is the report with its CSV, saying who sends it", async () => {
    await send();

    const mail: EmailEnvelope = stage.mails[0]!;

    expect(mail.templateType).toBe(EmailTemplateType.CloudCostReport);
    expect(mail.subject).toMatch(/^Weekly cloud costs by team: Nov 16/);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.attachments).toEqual([
      {
        fileName:
          "cloud-costs-by-service-amortized-2026-11-16-to-2026-11-22.csv",
        mimeType: "text/csv",
        contentBase64: Buffer.from(
          '"service","amount"\n"Amazon EC2","1200"\n',
          "utf8",
        ).toString("base64"),
      },
    ]);
    expect((mail.vars["report"] as Record<string, unknown>)["why"]).toBe(
      "This report is sent to this address from Acme on OneUptime. Ask the person who sends it to take the address off.",
    );
    expect(
      (mail.vars["report"] as Record<string, Array<string>>)["notes"],
    ).toContain("The figures are attached as a CSV.");
  });

  test("set by nobody who may, they are left out, each said", async () => {
    stage.report.outsideRecipientsSetByUserId = undefined as never;

    const result: CloudCostReportSendResult = await send();

    expect(result.addresses + result.channels).toBe(0);
    expect(result.skipped).toEqual([
      {
        who: "finance@example.org",
        reason: CloudCostReportSkipReason.NoOutsideSetter,
      },
      {
        who: "accountant@example.net",
        reason: CloudCostReportSkipReason.NoOutsideSetter,
      },
      { who: "#finops", reason: CloudCostReportSkipReason.NoOutsideSetter },
      {
        who: "Cost reviews",
        reason: CloudCostReportSkipReason.NoOutsideSetter,
      },
    ]);
  });

  test("once their Cloud admin is no longer one, nothing more goes outside", async () => {
    stage.permissions.set(
      ADMIN.id!.toString(),
      propsOf(ADMIN, [Permission.ReadCloudResource]),
    );

    const result: CloudCostReportSendResult = await send();

    expect(stage.mails).toEqual([]);
    expect(stage.posts).toEqual([]);
    expect(
      result.skipped.every((skip: { reason: string }) => {
        return skip.reason === CloudCostReportSkipReason.OutsideSetterMayNot;
      }),
    ).toBe(true);
    expect(result.skipped).toHaveLength(4);
  });

  test("a channel that did not take the message is said, with its workspace's words", async () => {
    stage.failingChannels.set("#finops", "channel_not_found");

    const result: CloudCostReportSendResult = await send();

    expect(result.channels).toBe(1);
    expect(result.skipped).toEqual([
      {
        who: "#finops",
        reason: CloudCostReportSkipReason.NotPosted,
        detail: "channel_not_found",
      },
    ]);
  });

  test("Microsoft Teams channels in no known team are left out, saying why", async () => {
    stage.teamsTeamId = undefined;

    const result: CloudCostReportSendResult = await send();

    expect(result.skipped).toEqual([
      {
        who: "Cost reviews",
        reason: CloudCostReportSkipReason.TeamsTeamUnknown,
        detail: "No team is named.",
      },
    ]);
  });

  test("a channel's message is short: the total, its change, and a button to Costs", () => {
    const blocks: Array<Record<string, unknown>> =
      CloudCostReportSender.getChatBlocks(
        writeCloudCostReport({
          content: contentFor({ props: {} }),
          translator: createTranslator(undefined, "en"),
        }),
      ) as unknown as Array<Record<string, unknown>>;

    expect(
      blocks.map((block: Record<string, unknown>) => {
        return block["_type"];
      }),
    ).toEqual([
      "WorkspacePayloadHeader",
      "WorkspacePayloadMarkdown",
      "WorkspacePayloadButtons",
    ]);
    expect(blocks[0]!["text"]).toBe("Weekly cloud costs by team");
    expect(String(blocks[1]!["text"])).toContain(
      "Total: **$1,200** (20% more than the week before)",
    );
    const button: Record<string, unknown> = (
      blocks[2]!["buttons"] as Array<Record<string, unknown>>
    )[0]!;
    expect(button["title"]).toBe("Open Costs");
    expect(String(button["url"])).toBe(
      "https://oneuptime.example/dashboard/p/cloud/costs?start=2026-11-16",
    );
  });
});

describe("Send Me a Copy", () => {
  beforeEach(() => {
    setStage(reportOf());
  });

  test("emails the person the report as they may read it", async () => {
    const answer: { email: string } = await CloudCostReportSender.sendCopy({
      reportId: REPORT,
      userId: ALICE.id!,
      props: propsOf(ALICE, [Permission.ReadCloudResource]),
      projectId: PROJECT,
      at: DUE,
    });

    expect(answer.email).toBe("alice@example.com");
    expect(stage.mails).toHaveLength(1);
    expect(stage.mails[0]!.toEmail!.toString()).toBe("alice@example.com");
    expect(stage.builds[0]!.props.userId!.toString()).toBe(
      ALICE.id!.toString(),
    );
  });

  test("never reads another project's report", async () => {
    stage.report.projectId = ObjectID.generate();

    await expect(
      CloudCostReportSender.sendCopy({
        reportId: REPORT,
        userId: ALICE.id!,
        props: propsOf(ALICE, [Permission.ReadCloudResource]),
        projectId: PROJECT,
        at: DUE,
      }),
    ).rejects.toThrow(BadDataException);
    expect(stage.mails).toEqual([]);
  });
});

describe("the schedule", () => {
  function due(id: string, nextSendAt: Date): CloudCostReport {
    const report: CloudCostReport = new CloudCostReport();
    report.id = new ObjectID(id);
    report.nextSendAt = nextSendAt;
    report.recurringInterval = {
      _type: "Recurring",
      value: {
        intervalType: "Week",
        intervalCount: { _type: "PositiveNumber", value: 1 },
      },
    } as never;
    report.sendFirstReportAt = new Date("2026-11-16T08:00:00.000Z");
    report.timezone = "Europe/Berlin" as never;
    return report;
  }

  test("sends each due report once: the replica that moves its next send on sends it", async () => {
    const claims: Array<{
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    }> = [];
    const sends: Array<Date> = [];
    const written: Array<Record<string, unknown>> = [];
    const won: Set<string> = new Set(["0192f1a0-1100-7000-8000-0000000f0001"]);

    jest
      .spyOn(CloudCostReportService, "findBy")
      .mockImplementation((async (data: { limit: number }) => {
        expect(data.limit).toBe(CLOUD_COST_REPORTS_PER_TICK);
        return [
          due("0192f1a0-1100-7000-8000-0000000f0001", DUE),
          // Claimed by another replica a moment before.
          due("0192f1a0-1100-7000-8000-0000000f0002", DUE),
        ];
      }) as never);
    jest
      .spyOn(CloudCostReportService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation((async (data: {
        id: ObjectID;
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      }) => {
        claims.push({ data: data.data, expectedData: data.expectedData });
        return won.has(data.id.toString());
      }) as never);
    jest
      .spyOn(CloudCostReportSender, "send")
      .mockImplementation(async (data: { at: Date }) => {
        sends.push(data.at);
        return {
          sentAt: data.at.toISOString(),
          people: 1,
          groupSections: 0,
          addresses: 0,
          channels: 0,
          skipped: [],
          errors: [],
        };
      });
    jest
      .spyOn(CloudCostReportService, "updateOneById")
      .mockImplementation((async (data: { data: Record<string, unknown> }) => {
        written.push(data.data);
      }) as never);

    const now: Date = new Date("2026-11-23T08:00:30.000Z");
    expect(await CloudCostReportSchedule.sendDue(now)).toBe(1);

    // Each claim expects the due time and moves it a week on, in Berlin.
    expect(claims).toHaveLength(2);
    expect(claims[0]!.expectedData).toEqual({ nextSendAt: DUE });
    expect(claims[0]!.data).toEqual({
      nextSendAt: new Date("2026-11-30T08:00:00.000Z"),
    });
    // The report covers the days of when it was due, not of when it ran.
    expect(sends).toEqual([DUE]);
    expect((written[0] as { lastSentAt?: Date }).lastSentAt).toEqual(now);
    expect(
      ((written[0] as { lastSendResult?: Record<string, unknown> })
        .lastSendResult || {})["people"],
    ).toBe(1);
  });

  test("a send that reached nobody is kept as the last result, but is no last send", async () => {
    const written: Array<Record<string, unknown>> = [];

    jest
      .spyOn(CloudCostReportService, "updateOneById")
      .mockImplementation((async (data: { data: Record<string, unknown> }) => {
        written.push(data.data);
      }) as never);

    await CloudCostReportSchedule.recordResult({
      reportId: REPORT,
      result: {
        sentAt: DUE.toISOString(),
        people: 0,
        groupSections: 0,
        addresses: 0,
        channels: 0,
        skipped: [{ who: "Dan", reason: CloudCostReportSkipReason.MayNotRead }],
        errors: [],
      },
      now: DUE,
    });

    expect((written[0] as { lastSentAt?: Date }).lastSentAt).toBeUndefined();
    expect(
      (written[0] as { lastSendResult: { skipped: Array<unknown> } })
        .lastSendResult.skipped,
    ).toHaveLength(1);
  });

  test("one report that fails does not stop the others", async () => {
    jest
      .spyOn(CloudCostReportService, "findBy")
      .mockImplementation((async () => {
        return [
          due("0192f1a0-1100-7000-8000-0000000f0001", DUE),
          due("0192f1a0-1100-7000-8000-0000000f0002", DUE),
        ];
      }) as never);
    jest
      .spyOn(CloudCostReportService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true as never);
    let calls: number = 0;
    jest.spyOn(CloudCostReportSender, "send").mockImplementation(async () => {
      calls++;

      if (calls === 1) {
        throw new Error("ClickHouse is restarting.");
      }

      return {
        sentAt: DUE.toISOString(),
        people: 1,
        groupSections: 0,
        addresses: 0,
        channels: 0,
        skipped: [],
        errors: [],
      };
    });
    jest
      .spyOn(CloudCostReportService, "updateOneById")
      .mockResolvedValue(undefined as never);

    expect(await CloudCostReportSchedule.sendDue(DUE)).toBe(1);
    expect(calls).toBe(2);
  });
});

describe("what a report may be saved with", () => {
  const MEMBER: DatabaseCommonInteractionProps = propsOf(ALICE, [
    Permission.CloudMember,
  ]);
  const CLOUD_ADMIN: DatabaseCommonInteractionProps = propsOf(CAROL, [
    Permission.CloudAdmin,
  ]);

  test("addresses and channels are read whole: each once, refused with what to fix", () => {
    const data: Record<string, unknown> = {
      emailAddresses: "Finance@Example.org, finance@example.org",
      slackChannelNames: ["#finops", "finops", "#cost-alerts"],
      microsoftTeamsChannelNames: "Cost reviews",
      microsoftTeamsTeamName: "  ",
    };

    CloudCostReportServiceClass.normalizeRecipients(data);

    expect(data["emailAddresses"]).toEqual(["finance@example.org"]);
    expect(data["slackChannelNames"]).toEqual(["#finops", "#cost-alerts"]);
    expect(data["microsoftTeamsChannelNames"]).toEqual(["Cost reviews"]);
    expect(data["microsoftTeamsTeamName"]).toBeNull();

    expect(() => {
      CloudCostReportServiceClass.normalizeRecipients({
        emailAddresses: "not an address",
      });
    }).toThrow(BadDataException);
    expect(() => {
      readCloudCostReportChannelNames(
        Array.from({ length: 11 }, (_value: unknown, index: number) => {
          return `#c${index}`;
        }),
        "Slack channels",
      );
    }).toThrow("A report posts to at most 10 Slack channels.");
  });

  test("a scope needs its record, and the other scopes' records are cleared", () => {
    const data: Record<string, unknown> = {
      scope: CloudCostReportScope.CostView,
      cloudCostViewId: VIEW,
      cloudAccountId: ObjectID.generate(),
    };

    CloudCostReportServiceClass.normalizeScope(data);

    expect(data["cloudCostViewId"]).toBe(VIEW);
    expect(data["cloudAccountId"]).toBeNull();
    expect(data["cloudCostGroupId"]).toBeNull();

    expect(() => {
      CloudCostReportServiceClass.normalizeScope({
        scope: CloudCostReportScope.Account,
      });
    }).toThrow(
      "A report of one account needs its account: send cloudAccountId.",
    );
    expect(() => {
      CloudCostReportServiceClass.normalizeScope({
        scope: CloudCostReportScope.CostGroup,
      });
    }).toThrow(
      "A report of a cost group needs its group: send cloudCostGroupId.",
    );
    expect(() => {
      CloudCostReportServiceClass.normalizeScope({ scope: "Everything" });
    }).toThrow("Send scope as AllAccounts, Account, CostGroup or CostView.");
  });

  test("only a cost view's report sends each group's team its section", () => {
    expect(() => {
      CloudCostReportServiceClass.normalizeScope({
        scope: CloudCostReportScope.AllAccounts,
        isSentToGroupTeams: true,
      });
    }).toThrow(
      "Only a report of a cost view sends each group's team its own section.",
    );

    const data: Record<string, unknown> = {};
    CloudCostReportServiceClass.normalizeScope(data);
    expect(data["scope"]).toBe(CloudCostReportScope.AllAccounts);
    expect(data["isSentToGroupTeams"]).toBe(false);
  });

  test("an edit that leaves the scope alone keeps the stored one's record", () => {
    const data: Record<string, unknown> = { isSentToGroupTeams: true };

    CloudCostReportServiceClass.normalizeScope(data, {
      scope: CloudCostReportScope.CostView,
      cloudCostViewId: VIEW,
    });

    expect(data).toEqual({ isSentToGroupTeams: true });
  });

  test("a period and a basis are one of their own, an empty basis the project's", () => {
    const data: Record<string, unknown> = { period: "", costBasis: "" };
    CloudCostReportServiceClass.normalizePeriodAndBasis(data);
    expect(data).toEqual({
      period: CloudCostReportPeriod.LastWeek,
      costBasis: null,
    });

    expect(() => {
      CloudCostReportServiceClass.normalizePeriodAndBasis({
        period: "LastYear",
      });
    }).toThrow("Send period as LastWeek, LastMonth or MonthToDate.");
    expect(() => {
      CloudCostReportServiceClass.normalizePeriodAndBasis({
        costBasis: "list",
      });
    }).toThrow(
      "Send costBasis as billed, amortized or net, or leave it out for the project's.",
    );
  });

  test("a report goes out weekly or monthly, never daily", () => {
    expect(
      getCloudCostReportIntervalProblem({
        _type: "Recurring",
        value: {
          intervalType: "Day",
          intervalCount: { _type: "PositiveNumber", value: 1 },
        },
      }),
    ).toContain("every week or every month");
    expect(
      getCloudCostReportIntervalProblem({
        _type: "Recurring",
        value: {
          intervalType: "Month",
          intervalCount: { _type: "PositiveNumber", value: 1 },
        },
      }),
    ).toBeNull();
    expect(getCloudCostReportIntervalProblem(undefined)).toBeNull();
  });

  test("addresses and channels need a Cloud admin, who is kept as the one the report is read as", () => {
    const write: Record<string, unknown> = {
      emailAddresses: ["finance@example.org"],
    };

    expect(() => {
      CloudCostReportServiceClass.checkOutsideRecipients({
        write: { ...write },
        props: MEMBER,
        projectId: PROJECT,
      });
    }).toThrow(new NotAuthorizedException(CLOUD_COST_REPORT_OUTSIDE_REFUSAL));

    CloudCostReportServiceClass.checkOutsideRecipients({
      write,
      props: CLOUD_ADMIN,
      projectId: PROJECT,
    });
    expect(String(write["outsideRecipientsSetByUserId"])).toBe(
      CAROL.id!.toString(),
    );

    // A Project Admin and a Project Owner may too.
    for (const permission of [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
    ]) {
      expect(
        CloudCostReportServiceClass.maySendOutside(
          propsOf(BOB, [permission]),
          PROJECT,
        ),
      ).toBe(true);
    }

    // A Cloud admin of another project may not.
    expect(
      CloudCostReportServiceClass.maySendOutside(
        CLOUD_ADMIN,
        ObjectID.generate(),
      ),
    ).toBe(false);
  });

  test("an API key sets no outside recipients: there is no person to read the report as", () => {
    expect(() => {
      CloudCostReportServiceClass.checkOutsideRecipients({
        write: { slackChannelNames: ["#finops"] },
        props: {
          tenantId: PROJECT,
          isRoot: false,
          userTenantAccessPermission: CLOUD_ADMIN.userTenantAccessPermission,
        } as DatabaseCommonInteractionProps,
        projectId: PROJECT,
      });
    }).toThrow(CLOUD_COST_REPORT_OUTSIDE_API_KEY_REFUSAL);
  });

  test("taking every outside recipient off is anyone's to do, and forgets who set them", () => {
    const write: Record<string, unknown> = {
      emailAddresses: [],
      slackChannelNames: [],
    };

    CloudCostReportServiceClass.checkOutsideRecipients({
      write,
      props: MEMBER,
      projectId: PROJECT,
    });

    expect(write["outsideRecipientsSetByUserId"]).toBeNull();

    // A write that leaves them alone reads nobody's permission.
    const other: Record<string, unknown> = { name: "Renamed" };
    CloudCostReportServiceClass.checkOutsideRecipients({
      write: other,
      props: MEMBER,
      projectId: PROJECT,
    });
    expect(other).toEqual({ name: "Renamed" });
  });
});
