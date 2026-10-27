import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import SecurityCaseNotifications from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import Project from "../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import UserNotificationSetting from "../../../../Models/DatabaseModels/UserNotificationSetting";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { getJestSpyOn } from "../../../Spy";
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
 * A security case counts custom channels as a channel that is on
 * (SecurityCaseNotifications.hasChannelOn). Somebody who switched every
 * channel of New Security Case off is not asked about a case; somebody who
 * hears of cases only through a custom channel - the company's own app,
 * often (UserNotificationSetting.alertByCustomChannel) - has switched
 * nothing off, and is told like anyone else.
 *
 * The settings read below answers with the columns it selects and no
 * others, as the database does, so a column the read forgets reads as off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111c1",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-2222222222c2");
const CASE_URL: string =
  "https://oneuptime.example.com/dashboard/project/security-events/cases/case";

type SettingColumns = Record<string, boolean>;

interface Member {
  id: ObjectID;
  name: string;
  email: string;
  // The New Security Case setting's channels; no row when undefined.
  setting?: SettingColumns | undefined;
}

interface SettingsRead {
  query: JSONObject;
  select: Record<string, boolean>;
  props: { isRoot?: boolean };
}

// The boolean alertBy* columns the setting has, as the model declares them.
function channelColumns(): Array<string> {
  const model: UserNotificationSetting = new UserNotificationSetting();

  return model
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      const metadata: TableColumnMetadata =
        model.getTableColumnMetadata(column);

      return (
        column.startsWith("alertBy") &&
        metadata.type === TableColumnType.Boolean
      );
    })
    .sort();
}

// Every channel off, or every channel off but the ones named.
function channelsOnly(...on: Array<string>): SettingColumns {
  const columns: SettingColumns = {};

  for (const column of channelColumns()) {
    columns[column] = on.includes(column);
  }

  return columns;
}

function member(name: string, index: number, setting?: SettingColumns): Member {
  return {
    id: new ObjectID(
      `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
    ),
    name,
    email: `${name.toLowerCase()}@example.com`,
    setting,
  };
}

function caseModel(): SecurityCase {
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
  return model;
}

// A security analyst of the project, as the permission check reads them.
function propsFor(userId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectUser, Permission.SecurityMember].map(
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

let members: Array<Member>;
let securityCase: SecurityCase;
let settingsReads: Array<SettingsRead>;
let told: Array<{ userId: string; eventType: string }>;

function findMember(userId: unknown): Member | undefined {
  return members.find((person: Member): boolean => {
    return person.id.toString() === String(userId);
  });
}

function toldNames(): Array<string> {
  return told.map((item: { userId: string }): string => {
    return findMember(item.userId)?.name || item.userId;
  });
}

async function caseReachesTheirPriority(): Promise<void> {
  await SecurityCaseNotifications.notifyPriorityReached({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
  });
}

beforeEach(() => {
  // The project's priorities and statuses: a new project's, High and above by default.
  stubSecurityCaseValues();
  members = [];
  securityCase = caseModel();
  settingsReads = [];
  told = [];

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      return securityCase;
    },
  );

  getJestSpyOn(
    SecurityCaseService,
    "compareAndSetColumnsByIdWithoutHooks",
  ).mockImplementation(async (args: unknown) => {
    const { data } = args as { data: JSONObject };

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

  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(async () => {
    return members.map((person: Member): TeamMember => {
      const row: TeamMember = new TeamMember();
      row.userId = person.id;
      const user: User = new User();
      user.name = person.name as never;
      user.email = person.email as never;
      row.user = user;
      return row;
    });
  });

  getJestSpyOn(UserService, "findOneById").mockImplementation(async () => {
    return null;
  });

  getJestSpyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "Blue Team";
    return team;
  });

  // The people's settings, with the selected columns only.
  getJestSpyOn(UserNotificationSettingService, "findBy").mockImplementation(
    async (args: unknown) => {
      const read: SettingsRead = args as SettingsRead;
      settingsReads.push(read);

      return members
        .filter((person: Member): boolean => {
          return Boolean(person.setting);
        })
        .map((person: Member): UserNotificationSetting => {
          const row: UserNotificationSetting = new UserNotificationSetting();
          const columns: Record<string, unknown> = row as unknown as Record<
            string,
            unknown
          >;
          row.userId = person.id;

          for (const [column, value] of Object.entries(person.setting!)) {
            if (read.select[column]) {
              columns[column] = value;
            }
          }

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
    told.push({
      userId: String(data["userId"]),
      eventType: String(data["eventType"]),
    });
  });

  getJestSpyOn(
    AccessTokenService,
    "getDatabaseCommonInteractionPropsByUserAndProject",
  ).mockImplementation(async (args: unknown) => {
    return propsFor((args as { userId: ObjectID }).userId);
  });

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockResolvedValue(undefined as never);

  getJestSpyOn(
    WorkspaceNotificationRuleService,
    "sendWorkspaceMarkdownNotification",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a security case and custom channels", () => {
  test("somebody who hears of cases only through custom channels is told when a case reaches their priority", async () => {
    members = [member("CustomOnly", 1, channelsOnly("alertByCustomChannel"))];

    await caseReachesTheirPriority();

    expect(toldNames()).toEqual(["CustomOnly"]);
    expect(told[0]!.eventType).toBe(
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
    );
  });

  test("somebody with every channel off, custom channels too, is not told; the others are", async () => {
    members = [
      member("Muted", 1, channelsOnly()),
      member("CustomOnly", 2, channelsOnly("alertByCustomChannel")),
      member("EmailOnly", 3, channelsOnly("alertByEmail")),
    ];

    await caseReachesTheirPriority();

    expect(toldNames()).toEqual(["CustomOnly", "EmailOnly"]);
  });

  test("custom channels off take nothing away: somebody with email on is still told", async () => {
    members = [
      member("Email", 1, {
        ...channelsOnly("alertByEmail"),
        alertByCustomChannel: false,
      }),
    ];

    await caseReachesTheirPriority();

    expect(toldNames()).toEqual(["Email"]);
  });

  test("the people's settings are read with their custom channel column", async () => {
    members = [member("CustomOnly", 1, channelsOnly("alertByCustomChannel"))];

    await caseReachesTheirPriority();

    expect(settingsReads.length).toBeGreaterThan(0);

    for (const read of settingsReads) {
      expect(read.select["alertByCustomChannel"]).toBe(true);
      expect(read.props.isRoot).toBe(true);
    }
  });

  test("the read selects every channel the setting has, so none reads as off by being left out", async () => {
    members = [member("Analyst", 1, channelsOnly("alertByEmail"))];

    await caseReachesTheirPriority();

    for (const column of channelColumns()) {
      expect({ column, selected: settingsReads[0]!.select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });

  test.each(channelColumns())(
    "somebody with only %s on is told",
    async (column: string) => {
      members = [member("OneChannel", 1, channelsOnly(column))];

      await caseReachesTheirPriority();

      expect(toldNames()).toEqual(["OneChannel"]);
    },
  );
});

describe("SecurityCaseNotifications.hasChannelOn", () => {
  // The private check, as notifyPriorityReached asks it.
  const hasChannelOn: (setting: UserNotificationSetting) => boolean = (
    setting: UserNotificationSetting,
  ): boolean => {
    return (
      SecurityCaseNotifications as unknown as {
        hasChannelOn: (setting: UserNotificationSetting) => boolean;
      }
    ).hasChannelOn(setting);
  };

  function settingWith(columns: SettingColumns): UserNotificationSetting {
    const setting: UserNotificationSetting = new UserNotificationSetting();
    Object.assign(setting, columns);
    return setting;
  }

  test("counts custom channels as a channel that is on", () => {
    expect(
      hasChannelOn(settingWith(channelsOnly("alertByCustomChannel"))),
    ).toBe(true);
  });

  test.each(channelColumns())("counts %s alone", (column: string) => {
    expect(hasChannelOn(settingWith(channelsOnly(column)))).toBe(true);
  });

  test("every channel off, custom channels too, is nothing on", () => {
    expect(hasChannelOn(settingWith(channelsOnly()))).toBe(false);
  });

  test("a setting with no channel read at all is nothing on", () => {
    expect(hasChannelOn(new UserNotificationSetting())).toBe(false);
  });

  test("the setting has the custom channel column to count", () => {
    expect(channelColumns()).toContain("alertByCustomChannel");
  });
});
