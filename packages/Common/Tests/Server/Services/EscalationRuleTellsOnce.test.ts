import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import OnCallChatByWorkspace from "../../../Server/Utils/OnCall/OnCallChatByWorkspace";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import PendingInviteeProfiles from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import URL from "../../../Types/API/URL";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import ReachWorld, {
  ANA,
  BO,
  CY,
  IVY,
  PAYMENTS_TEAM,
  PLATFORM,
  POLICY_ID,
  PRIMARY,
  PROJECT_ID,
  SECONDARY,
  WorldScheduleRow,
  WorldTeamRow,
  WorldUserRow,
} from "../Utils/OnCall/EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * SOMEONE ON AN ESCALATION RULE TWICE OVER IS TOLD ONCE (#10464).
 *
 * A person can be on one rule through several of its rows: named on it, a
 * member of one or two of its teams, on call in one of its schedules. Each
 * row used to tell them on its own: "added" twice for one rule, and
 * "removed" - with their on-call time log for it ended - while another row
 * still paged them. Here the three services' hooks run as a create and a
 * delete run them, over a rule kept in memory (EscalationRuleReachWorld),
 * and every overlap is added and taken away in both orders:
 *
 *   - "added" once, when the rule starts paging them; being named is news
 *     to someone the rule pages only while they are on call in one of its
 *     schedules, and a schedule's add is no news to someone it named;
 *   - "removed" only when nothing on the rule pages them any more, and the
 *     time logs of the paths left stay open;
 *   - someone only invited is told nothing and logged nowhere, either way;
 *   - the policy's feed hears of every row, whoever else names the person.
 */

const POLICY_LINK: string = "https://oneuptime.test/policies/payments";

const ADDED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;
const REMOVED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

interface Told {
  userId: string;
  eventType: NotificationSettingEventType;
}

let world: ReachWorld;
let told: Array<Told>;
let feed: Array<string>;

// The rows the services' hooks read back by id, as the world made them.
let models: Map<string, BaseModel>;

type Hooks = {
  onCreateSuccess: (onCreate: unknown, createdItem: BaseModel) => Promise<unknown>;
  onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
  onDeleteSuccess: (
    onDelete: unknown,
    itemIdsBeforeDelete: Array<ObjectID>,
  ) => Promise<unknown>;
};

const userHooks: Hooks =
  OnCallDutyPolicyEscalationRuleUserService as unknown as Hooks;
const teamHooks: Hooks =
  OnCallDutyPolicyEscalationRuleTeamService as unknown as Hooks;
const scheduleHooks: Hooks =
  OnCallDutyPolicyEscalationRuleScheduleService as unknown as Hooks;

function rule(ruleId: ObjectID): OnCallDutyPolicyEscalationRule {
  const model: OnCallDutyPolicyEscalationRule =
    new OnCallDutyPolicyEscalationRule();
  model._id = ruleId.toString();
  model.name = "Level 1";
  model.order = 1;
  return model;
}

function policy(): OnCallDutyPolicy {
  const model: OnCallDutyPolicy = new OnCallDutyPolicy();
  model._id = POLICY_ID.toString();
  model.name = "Payments";
  return model;
}

function userRowModel(row: WorldUserRow): OnCallDutyPolicyEscalationRuleUser {
  const model: OnCallDutyPolicyEscalationRuleUser =
    new OnCallDutyPolicyEscalationRuleUser();
  const user: User = new User();
  user._id = row.userId.toString();

  model._id = row.id.toString();
  model.projectId = PROJECT_ID;
  model.userId = row.userId;
  model.user = user;
  model.onCallDutyPolicyEscalationRuleId = row.ruleId;
  model.onCallDutyPolicyEscalationRule = rule(row.ruleId);
  model.onCallDutyPolicyId = POLICY_ID;
  model.onCallDutyPolicy = policy();
  model.createdAt = row.createdAt;
  return model;
}

function teamRowModel(row: WorldTeamRow): OnCallDutyPolicyEscalationRuleTeam {
  const model: OnCallDutyPolicyEscalationRuleTeam =
    new OnCallDutyPolicyEscalationRuleTeam();
  const team: Team = new Team();
  team._id = row.teamId.toString();
  team.name = row.teamId.toString() === PLATFORM.toString() ? "Platform" : "Payments";

  model._id = row.id.toString();
  model.projectId = PROJECT_ID;
  model.teamId = row.teamId;
  model.team = team;
  model.onCallDutyPolicyEscalationRuleId = row.ruleId;
  model.onCallDutyPolicyEscalationRule = rule(row.ruleId);
  model.onCallDutyPolicyId = POLICY_ID;
  model.onCallDutyPolicy = policy();
  model.createdAt = row.createdAt;
  return model;
}

function scheduleRowModel(
  row: WorldScheduleRow,
): OnCallDutyPolicyEscalationRuleSchedule {
  const model: OnCallDutyPolicyEscalationRuleSchedule =
    new OnCallDutyPolicyEscalationRuleSchedule();
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule._id = row.scheduleId.toString();
  schedule.name = "Primary";

  model._id = row.id.toString();
  model.projectId = PROJECT_ID;
  model.onCallDutyPolicyScheduleId = row.scheduleId;
  model.onCallDutyPolicySchedule = schedule;
  model.pageNextInRotation = row.pageNextInRotation;
  model.onCallDutyPolicyEscalationRuleId = row.ruleId;
  model.onCallDutyPolicyEscalationRule = rule(row.ruleId);
  model.onCallDutyPolicyId = POLICY_ID;
  model.onCallDutyPolicy = policy();
  model.createdAt = row.createdAt;
  return model;
}

async function namePerson(userId: ObjectID): Promise<WorldUserRow> {
  const row: WorldUserRow = world.namePerson(userId);
  const model: OnCallDutyPolicyEscalationRuleUser = userRowModel(row);
  models.set(row.id.toString(), model);
  await userHooks.onCreateSuccess({}, model);
  return row;
}

async function nameTeam(teamId: ObjectID): Promise<WorldTeamRow> {
  const row: WorldTeamRow = world.nameTeam(teamId);
  const model: OnCallDutyPolicyEscalationRuleTeam = teamRowModel(row);
  models.set(row.id.toString(), model);
  await teamHooks.onCreateSuccess({}, model);
  return row;
}

async function nameSchedule(
  scheduleId: ObjectID,
  options?: { pageNextInRotation?: boolean },
): Promise<WorldScheduleRow> {
  const row: WorldScheduleRow = world.nameSchedule(scheduleId, options);
  const model: OnCallDutyPolicyEscalationRuleSchedule = scheduleRowModel(row);
  models.set(row.id.toString(), model);
  await scheduleHooks.onCreateSuccess({}, model);
  return row;
}

// A delete as DatabaseService runs it: what goes is read, then gone, then told.
async function takeOff(
  hooks: Hooks,
  row: WorldUserRow | WorldTeamRow | WorldScheduleRow,
): Promise<void> {
  const model: BaseModel = models.get(row.id.toString())!;

  jest
    .spyOn(hooks as never, "findRowsAndHoldDeleteToThem" as never)
    .mockResolvedValue([model] as never);

  await hooks.onBeforeDelete({
    query: { _id: row.id },
    props: { isRoot: true },
  });

  world.remove(row);

  await hooks.onDeleteSuccess(
    { deleteBy: {}, carryForward: { deletedItems: [model] } },
    [],
  );
}

function toldThat(eventType: NotificationSettingEventType): Array<string> {
  return told
    .filter((each: Told): boolean => {
      return each.eventType === eventType;
    })
    .map((each: Told): string => {
      return each.userId;
    })
    .sort();
}

const idsOf: (...ids: Array<ObjectID>) => Array<string> = (
  ...ids: Array<ObjectID>
): Array<string> => {
  return ids
    .map((id: ObjectID): string => {
      return id.toString();
    })
    .sort();
};

beforeEach(() => {
  world = new ReachWorld();
  world.install();
  told = [];
  feed = [];
  models = new Map<string, BaseModel>();

  // Ana and Bo are in Platform, Ana in Payments too; Ivy is only invited.
  world.addMember(ANA, PLATFORM, true);
  world.addMember(BO, PLATFORM, true);
  world.addMember(ANA, PAYMENTS_TEAM, true);
  world.addMember(CY, PAYMENTS_TEAM, true);
  world.addMember(IVY, PLATFORM, false);

  jest
    .spyOn(OnDutyPoliciesCache, "forgetProjects")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      eventType: NotificationSettingEventType;
    }): Promise<void> => {
      told.push({ userId: data.userId.toString(), eventType: data.eventType });
    }) as never);
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString(POLICY_LINK) as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`Ana Lopez` as never);
  jest.spyOn(UserService, "findOneById").mockResolvedValue({
    name: "Ana Lopez",
    email: "ana@acme.example",
  } as never);
  jest
    .spyOn(PendingInviteeProfiles, "nameInProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallChatByWorkspace.prototype, "write")
    .mockResolvedValue({} as never);
  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockImplementation((async (item: {
      feedInfoInMarkdown: string;
    }): Promise<void> => {
      feed.push(item.feedInfoInMarkdown);
    }) as never);
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockResolvedValue({} as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined as never);

  for (const hooks of [userHooks, teamHooks, scheduleHooks]) {
    jest
      .spyOn(hooks as never, "findOneById" as never)
      .mockImplementation((async (args: {
        id: ObjectID;
      }): Promise<BaseModel | null> => {
        return models.get(args.id.toString()) || null;
      }) as never);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("named on the rule, and in one of its teams", () => {
  test("named first: the team's add tells its other people, not her again", async () => {
    await namePerson(ANA);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA));

    told = [];
    await nameTeam(PLATFORM);

    expect(toldThat(ADDED)).toEqual(idsOf(BO));
    // Each row is a change to the policy: the feed hears of both.
    expect(feed).toHaveLength(2);
    // Her time on the rule is kept for each path: by name, and the team's.
    expect(world.logsOf(ANA)).toEqual([
      "start named",
      `start team ${PLATFORM.toString()}`,
    ]);
  });

  test("the team first: being named after is no news to her", async () => {
    await nameTeam(PLATFORM);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA, BO));

    told = [];
    await namePerson(ANA);

    expect(told).toEqual([]);
    expect(feed).toHaveLength(2);
    expect(world.logsOf(ANA)).toEqual([
      `start team ${PLATFORM.toString()}`,
      "start named",
    ]);
  });

  test("taken off by name while the team still pages her: not told she was removed, and still logged as on call", async () => {
    const named: WorldUserRow = await namePerson(ANA);
    await nameTeam(PLATFORM);
    told = [];
    world.timeLogs = [];

    await takeOff(userHooks, named);

    expect(told).toEqual([]);
    // The log by name ends; the team's stays open - one more start keeps it so.
    expect(world.logsOf(ANA)).toEqual([
      "end named",
      `start team ${PLATFORM.toString()}`,
    ]);
    expect(feed.pop()).toContain("Removed **Ana Lopez**");
  });

  test("the team taken off while she is still named: only its other people are told", async () => {
    await namePerson(ANA);
    const team: WorldTeamRow = await nameTeam(PLATFORM);
    told = [];
    world.timeLogs = [];

    await takeOff(teamHooks, team);

    expect(toldThat(REMOVED)).toEqual(idsOf(BO));
    expect(world.logsOf(ANA)).toEqual([
      `end team ${PLATFORM.toString()}`,
      "start named",
    ]);
    expect(world.logsOf(BO)).toEqual([`end team ${PLATFORM.toString()}`]);
  });

  test("both taken off, either way round: she hears it once, when the last goes", async () => {
    const named: WorldUserRow = await namePerson(ANA);
    const team: WorldTeamRow = await nameTeam(PLATFORM);
    told = [];

    await takeOff(teamHooks, team);
    expect(toldThat(REMOVED)).toEqual(idsOf(BO));

    await takeOff(userHooks, named);
    expect(toldThat(REMOVED)).toEqual(idsOf(ANA, BO));
  });

  test("the other way round: named taken off first, then the team", async () => {
    const named: WorldUserRow = await namePerson(ANA);
    const team: WorldTeamRow = await nameTeam(PLATFORM);
    told = [];

    await takeOff(userHooks, named);
    expect(told).toEqual([]);

    await takeOff(teamHooks, team);
    expect(toldThat(REMOVED)).toEqual(idsOf(ANA, BO));
  });

  test("a team she joined after it was put on the rule: taken off by name, her team log opens now", async () => {
    // Platform is on the rule with Bo; Ana joins it later, as she is named.
    world.memberships = world.memberships.filter((each: { userId: ObjectID; teamId: ObjectID }) => {
      return !(each.userId.toString() === ANA.toString() && each.teamId.toString() === PLATFORM.toString());
    });
    await nameTeam(PLATFORM);
    const named: WorldUserRow = await namePerson(ANA);
    world.addMember(ANA, PLATFORM, true);
    told = [];
    world.timeLogs = [];

    await takeOff(userHooks, named);

    expect(told).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([
      "end named",
      `start team ${PLATFORM.toString()}`,
    ]);
  });
});

describe("in two of its teams", () => {
  test("the second team's add is no news to her; its other people are told", async () => {
    await nameTeam(PLATFORM);
    told = [];

    await nameTeam(PAYMENTS_TEAM);

    expect(toldThat(ADDED)).toEqual(idsOf(CY));
    expect(world.logsOf(ANA)).toEqual([
      `start team ${PLATFORM.toString()}`,
      `start team ${PAYMENTS_TEAM.toString()}`,
    ]);
  });

  test("one team taken off while the other pages her: not told; the other's log stays open", async () => {
    const platform: WorldTeamRow = await nameTeam(PLATFORM);
    await nameTeam(PAYMENTS_TEAM);
    told = [];
    world.timeLogs = [];

    await takeOff(teamHooks, platform);

    expect(toldThat(REMOVED)).toEqual(idsOf(BO));
    expect(world.logsOf(ANA)).toEqual([
      `end team ${PLATFORM.toString()}`,
      `start team ${PAYMENTS_TEAM.toString()}`,
    ]);
  });

  test("both teams taken off in one delete: she hears it once", async () => {
    const platform: WorldTeamRow = await nameTeam(PLATFORM);
    const payments: WorldTeamRow = await nameTeam(PAYMENTS_TEAM);
    told = [];

    world.remove(platform);
    world.remove(payments);
    await teamHooks.onDeleteSuccess(
      {
        deleteBy: {},
        carryForward: {
          deletedItems: [
            models.get(platform.id.toString()),
            models.get(payments.id.toString()),
          ],
        },
      },
      [],
    );

    expect(toldThat(REMOVED)).toEqual(idsOf(ANA, BO, CY));
  });
});

describe("on call in one of its schedules", () => {
  beforeEach(() => {
    world.onCall.set(PRIMARY.toString(), ANA);
  });

  test("named, then the schedule she is on call in is added: no news to her", async () => {
    await namePerson(ANA);
    told = [];

    await nameSchedule(PRIMARY);

    expect(told).toEqual([]);
    // Her time on call through the schedule is kept on its own.
    expect(world.logsOf(ANA)).toEqual([
      "start named",
      `start schedule ${PRIMARY.toString()}`,
    ]);
  });

  test("the schedule first: being named is news - it pages her at any time, not for a shift", async () => {
    await nameSchedule(PRIMARY);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA));

    told = [];
    await namePerson(ANA);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA));
  });

  test("whoever else is on call when a schedule is added is told, if nothing on the rule paged them", async () => {
    world.onCall.set(PRIMARY.toString(), BO);
    await namePerson(ANA);
    told = [];

    await nameSchedule(PRIMARY);

    expect(toldThat(ADDED)).toEqual(idsOf(BO));
  });

  test("a schedule added where she is on call in another of its schedules already: no news", async () => {
    world.onCall.set(SECONDARY.toString(), ANA);
    await nameSchedule(SECONDARY);
    told = [];

    await nameSchedule(PRIMARY);

    expect(told).toEqual([]);
  });

  test("taken off by name while she is on call in its schedule: not told until the shift's hand-off", async () => {
    await nameSchedule(PRIMARY);
    const named: WorldUserRow = await namePerson(ANA);
    told = [];
    world.timeLogs = [];

    await takeOff(userHooks, named);

    expect(told).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([
      "end named",
      `start schedule ${PRIMARY.toString()}`,
    ]);
  });

  test("the schedule taken off while she is named: not told; her log by name stays open", async () => {
    await namePerson(ANA);
    const schedule: WorldScheduleRow = await nameSchedule(PRIMARY);
    told = [];
    world.timeLogs = [];

    await takeOff(scheduleHooks, schedule);

    expect(told).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([
      `end schedule ${PRIMARY.toString()}`,
      "start named",
    ]);
  });

  test("the schedule taken off when nothing else pages her: told, as before", async () => {
    const schedule: WorldScheduleRow = await nameSchedule(PRIMARY);
    told = [];

    await takeOff(scheduleHooks, schedule);

    expect(toldThat(REMOVED)).toEqual(idsOf(ANA));
  });

  test("taken off by name while she is next in a rotation the rule pages: not told", async () => {
    world.onCall.set(SECONDARY.toString(), BO);
    world.next.set(SECONDARY.toString(), ANA);
    await nameSchedule(SECONDARY, { pageNextInRotation: true });
    const named: WorldUserRow = await namePerson(ANA);
    told = [];
    world.timeLogs = [];

    await takeOff(userHooks, named);

    expect(told).toEqual([]);
    // The next in a rotation is a backup, and was never logged as on call.
    expect(world.logsOf(ANA)).toEqual(["end named"]);
  });
});

describe("someone only invited is told nothing and logged nowhere", () => {
  test("named on the rule: no message, no time log - the feed still hears of the row", async () => {
    await namePerson(IVY);

    expect(told).toEqual([]);
    expect(world.logsOf(IVY)).toEqual([]);
    expect(feed).toHaveLength(1);
  });

  test("a team they are invited to: its members are told, they are not", async () => {
    await nameTeam(PLATFORM);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA, BO));
    expect(world.logsOf(IVY)).toEqual([]);
  });

  test("on call in a schedule added to the rule: not told, not logged", async () => {
    world.onCall.set(PRIMARY.toString(), IVY);

    await nameSchedule(PRIMARY);

    expect(told).toEqual([]);
    expect(world.logsOf(IVY)).toEqual([]);
  });

  test("taken off again - the invitation withdrawn: nothing told, and any log of theirs ends", async () => {
    const named: WorldUserRow = await namePerson(IVY);
    world.timeLogs = [];

    await takeOff(userHooks, named);

    expect(told).toEqual([]);
    expect(world.logsOf(IVY)).toEqual(["end named"]);
  });

  test("a team taken off: its invitee is not told, and their team log, if any, ends", async () => {
    const team: WorldTeamRow = await nameTeam(PLATFORM);
    told = [];
    world.timeLogs = [];

    await takeOff(teamHooks, team);

    expect(toldThat(REMOVED)).toEqual(idsOf(ANA, BO));
    expect(world.logsOf(IVY)).toEqual([`end team ${PLATFORM.toString()}`]);
  });
});

describe("a read that fails tells and logs as before", () => {
  test("named: told, and logged", async () => {
    world.failReads = true;

    await namePerson(ANA);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA));
    expect(world.logsOf(ANA)).toEqual(["start named"]);
  });

  test("a team: its accepted members are told and logged - never its invitees", async () => {
    world.failReads = true;

    await nameTeam(PLATFORM);

    expect(toldThat(ADDED)).toEqual(idsOf(ANA, BO));
    expect(world.logsOf(IVY)).toEqual([]);
  });
});
